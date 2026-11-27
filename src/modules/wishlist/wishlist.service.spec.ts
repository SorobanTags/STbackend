import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WishlistService } from './wishlist.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('WishlistService (Issue #70)', () => {
  let service: WishlistService;

  const mockPrisma = {
    course: {
      findFirst: jest.fn(),
    },
    wishlistItem: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WishlistService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WishlistService>(WishlistService);
    jest.clearAllMocks();
  });

  describe('add', () => {
    it('creates a wishlist item on the happy path', async () => {
      mockPrisma.course.findFirst.mockResolvedValue({ id: 'course-1' });
      mockPrisma.wishlistItem.findUnique.mockResolvedValue(null);
      mockPrisma.wishlistItem.create.mockResolvedValue({
        id: 'wish-1',
        studentId: 'student-1',
        courseId: 'cour
      ],
    }).compile();

    service = module.get<WishlistService>(WishlistService);
    jest.clearAllMocks();
  });

  describe('add', () => {
    it('creates a wishlist item on the happy path', async () => {
      mockPrisma.course.findFirst.mockResolvedValue({ id: 'course-1' });
      mockPrisma.wishlistItem.findUnique.mockResolvedValue(null);
      mockPrisma.wishlistItem.create.mockResolvedValue({
        id: 'wish-1',
        studentId: 'student-1',
        courseId: 'course-1',
      });

      const result = await service.add('student-1', 'course-1');

      expect(mockPrisma.wishlistItem.create).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('returns alreadySaved: true and does not create when item exists', async () => {
      mockPrisma.course.findFirst.mockResolvedValue({ id: 'course-1' });
      mockPrisma.wishlistItem.findUnique.mockResolvedValue({
        id: 'wish-1',
        studentId: 'student-1',
        courseId: 'course-1',
      });

      const result = await service.add('student-1', 'course-1');

      expect(result).toEqual({ alreadySaved: true });
      expect(mockPrisma.wishlistItem.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the course does not exist', async () => {
      mockPrisma.course.findFirst.mockResolvedValue(null);

      await expect(service.add('student-1', 'missing-course')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.wishlistItem.create).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the item is absent', async () => {
      mockPrisma.wishlistItem.findUnique.mockResolvedValue(null);

      await expect(service.remove('student-1', 'course-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.wishlistItem.delete).not.toHaveBeenCalled();
    });

    it('deletes the item when present', async () => {
      mockPrisma.wishlistItem.findUnique.mockResolvedValue({
        id: 'wish-1',
        studentId: 'student-1',
        courseId: 'course-1',
      });
      mockPrisma.wishlistItem.delete.mockResolvedValue({ id: 'wish-1' });

      await service.remove('student-1', 'course-1');

      expect(mockPrisma.wishlistItem.delete).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('computes skip/take and returns pagination meta', async () => {
      const items = [{ id: 'wish-1' }];
      mockPrisma.wishlistItem.findMany.mockResolvedValue(items);
      mockPrisma.wishlistItem.count.mockResolvedValue(25);
      mockPrisma.$transaction.mockResolvedValue([items, 25]);

      const result = await service.findAll('student-1', 3, 10);

      expect(mockPrisma.wishlistItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result).toEqual({
        data: items,
        meta: { total: 25, page: 3, limit: 10 },
      });
    });
  });

  describe('findAll pagination clamping', () => {
    it('clamps page 0 to page 1 and passes skip: 0', async () => {
      const result = await service.findAll('student-1', 0, 20);

      expect(prisma.wishlistItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
      expect(result.meta.page).toBe(1);
    });

    it('clamps an oversized limit to 100 and passes take: 100', async () => {
      const result = await service.findAll('student-1', 1, 5000);

      expect(prisma.wishlistItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
      expect(result.meta.limit).toBe(100);
    });

    it('keeps valid page and limit values unchanged', async () => {
      const result = await service.findAll('student-1', 2, 10);

      expect(prisma.wishlistItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
      expect(result.meta.page).toBe(2);
      expect(result.meta.limit).toBe(10);
    });
  });
    });
  });
});
