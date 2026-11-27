import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWishlistItemDto } from './dto/create-wishlist-item.dto';
import { UpdateWishlistItemDto } from './dto/update-wishlist-item.dto';

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(studentId: string, page = 1, limit = 20) {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 20));

    const where = { studentId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.wishlistItem.findMany({
        where,
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.wishlistItem.count({ where }),
    ]);

    return {
      data: items,
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async findOne(studentId: string, id: string) {
    const item = await this.prisma.wishlistItem.findFirst({
      where: { id, studentId },
    });
    if (!item) {
      throw new NotFoundException('Wishlist item not found');
    }
    return item;
  }

  async create(studentId: string, dto: CreateWishlistItemDto) {
    return this.prisma.wishlistItem.create({
      data: { ...dto, studentId },
    });
  }

  async update(studentId: string, id: string, dto: UpdateWishlistItemDto) {
    await this.findOne(studentId, id);
    return this.prisma.wishlistItem.update({
      where: { id },
      data: dto,
    });
  }

  async remove(studentId: string, id: string) {
    await this.findOne(studentId, id);
    return this.prisma.wishlistItem.delete({ where: { id } });
  }
}
