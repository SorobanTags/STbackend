import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { TagsService } from './tags.service';

describe('TagsService', () => {
  let service: TagsService;
  let prisma: {
    tag: { findMany: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      tag: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TagsService, { provide: PrismaService, useValue: prisma }],
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
});
