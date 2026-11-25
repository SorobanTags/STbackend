import { Test, TestingModule } from '@nestjs/testing';
import { WishlistService } from './wishlist.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('WishlistService', () => {
  let service: WishlistService;
  let prisma: {
    wishlistItem: {
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      wishlistItem: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WishlistService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WishlistService>(WishlistService);
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
