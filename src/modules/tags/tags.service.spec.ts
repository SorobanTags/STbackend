import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TagsService } from './tags.service';

describe('TagsService', () => {
  let service: TagsService;
  let prisma: {
    tag: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let auditLog: { createEntry: jest.Mock };

  beforeEach(async () => {
    prisma = {
      tag: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    };
    auditLog = {
      createEntry: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TagsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: auditLog },
      ],
    }).compile();

    service = module.get<TagsService>(TagsService);
  });

  describe('findAll', () => {
    it('clamps page=0 to a skip of 0', async () => {
      await service.findAll({ page: 0, limit: 20 });

      expect(prisma.tag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('clamps limit=1000 to a take of 100', async () => {
      await service.findAll({ page: 1, limit: 1000 });

      expect(prisma.tag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });
  });

  it('creates a tag with a normalized slug for Web Design', async () => {
    const tag = {
      id: 'tag-1',
      name: 'web-design',
      label: 'Web Design',
    };
    prisma.tag.findUnique.mockResolvedValue(null);
    prisma.tag.create.mockResolvedValue(tag);

    await expect(
      service.create('admin-1', { label: 'Web Design' }),
    ).resolves.toEqual(tag);

    expect(prisma.tag.create).toHaveBeenCalledWith({
      data: { name: 'web-design', label: 'Web Design' },
    });
    expect(auditLog.createEntry).toHaveBeenCalledTimes(1);
  });

  it('creates a tag with a normalized slug for UI/UX & Branding', async () => {
    const tag = {
      id: 'tag-2',
      name: 'ui-ux-branding',
      label: 'UI/UX & Branding',
    };
    prisma.tag.findUnique.mockResolvedValue(null);
    prisma.tag.create.mockResolvedValue(tag);

    await expect(
      service.create('admin-1', { label: 'UI/UX & Branding' }),
    ).resolves.toEqual(tag);

    expect(prisma.tag.create).toHaveBeenCalledWith({
      data: { name: 'ui-ux-branding', label: 'UI/UX & Branding' },
    });
  });

  it('rejects distinct labels that normalize to the existing slug', async () => {
    const existing = {
      id: 'tag-3',
      name: 'ui-ux',
      label: 'UI/UX',
    };
    prisma.tag.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    prisma.tag.create.mockResolvedValue(existing);

    await service.create('admin-1', { label: 'UI/UX' });

    await expect(
      service.create('admin-2', { label: 'UI UX' }),
    ).rejects.toThrow(
      new ConflictException(
        'A tag with label "UI/UX" already exists (slug: "ui-ux")',
      ),
    );

    expect(prisma.tag.findUnique).toHaveBeenNthCalledWith(2, {
      where: { name: 'ui-ux' },
    });
    expect(prisma.tag.create).toHaveBeenCalledTimes(1);
    expect(auditLog.createEntry).toHaveBeenCalledTimes(1);
  });

  it('rejects a label with no alphanumeric slug before any database write', async () => {
    await expect(
      service.create('admin-1', { label: '!!!' }),
    ).rejects.toThrow(
      new BadRequestException(
        'Tag label must contain at least one alphanumeric character',
      ),
    );

    expect(prisma.tag.findUnique).not.toHaveBeenCalled();
    expect(prisma.tag.create).not.toHaveBeenCalled();
    expect(auditLog.createEntry).not.toHaveBeenCalled();
  });

  it('never updates a tag with an empty normalized slug', async () => {
    const existing = {
      id: 'tag-4',
      name: 'web-design',
      label: 'Web Design',
    };
    prisma.tag.findUnique.mockResolvedValue(existing);

    await expect(
      service.update('tag-4', 'admin-1', { label: '!!!' }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.tag.update).not.toHaveBeenCalled();
    expect(auditLog.createEntry).not.toHaveBeenCalled();
  });
});
