// reviews.service.ts
import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollmentsService: EnrollmentsService,
  ) {}

  async create(studentId: string, courseId: string, dto: CreateReviewDto) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');

    const isEnrolled = await this.enrollmentsService.isEnrolled(studentId, courseId);
    if (!isEnrolled) {
      throw new ForbiddenException('You must be enrolled in this course to leave a review');
    }

    const existing = await this.prisma.courseReview.findUnique({
      where: { courseId_studentId: { courseId, studentId } },
    });
    if (existing) throw new ConflictException('You have already reviewed this course');

    return this.prisma.$transaction(async (tx) => {
      const review = await tx.courseReview.create({
        data: { courseId, studentId, rating: dto.rating, comment: dto.comment },
      });
      await this.recomputeCourseRating(courseId, tx);
      return review;
    });
  }

  async findForCourse(courseId: string, page = 1, limit = 20) {
    const where = { courseId };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.courseReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { student: { select: { id: true, name: true, avatarUrl: true } } },
      }),
      this.prisma.courseReview.count({ where }),
    ]);

    return { data, meta: { total, page, limit } };
  }

  async updateMyReview(studentId: string, courseId: string, dto: UpdateReviewDto) {
    const review = await this.prisma.courseReview.findUnique({
      where: { courseId_studentId: { courseId, studentId } },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (review.studentId !== studentId) throw new ForbiddenException('You cannot edit this review');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.courseReview.update({
        where: { courseId_studentId: { courseId, studentId } },
        data: {
          ...(dto.rating !== undefined && { rating: dto.rating }),
          ...(dto.comment !== undefined && { comment: dto.comment }),
        },
      });
      await this.recomputeCourseRating(courseId, tx);
      return updated;
    });
  }

  async deleteMyReview(studentId: string, courseId: string) {
    const review = await this.prisma.courseReview.findUnique({
      where: { courseId_studentId: { courseId, studentId } },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (review.studentId !== studentId) throw new ForbiddenException('You cannot delete this review');

    return this.prisma.$transaction(async (tx) => {
      await tx.courseReview.delete({
        where: { courseId_studentId: { courseId, studentId } },
      });
      await this.recomputeCourseRating(courseId, tx);
      return { message: 'Review deleted' };
    });
  }

  async adminDeleteReview(reviewId: string) {
    const review = await this.prisma.courseReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Review not found');

    return this.prisma.$transaction(async (tx) => {
      await tx.courseReview.delete({ where: { id: reviewId } });
      await this.recomputeCourseRating(review.courseId, tx);
      return { message: 'Review deleted by admin' };
    });
  }

  private async recomputeCourseRating(courseId: string, tx: Prisma.TransactionClient) {
    const agg = await tx.courseReview.aggregate({
      where: { courseId },
      _avg: { rating: true },
      _count: { _all: true },
    });

    await tx.course.update({
      where: { id: courseId },
      data: {
        avgRating: agg._avg.rating ?? 0,
        totalReviews: agg._count._all,
      },
    });
  }
}
