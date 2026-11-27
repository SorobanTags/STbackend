import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TagsService } from './tags.service';

describe('TagsService', () => {
  const prisma = {
    tag: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const auditLog = {
    createEntry: jest.fn().mockResolvedValue(undefined),
  };
  let service: TagsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TagsService(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
    );
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
