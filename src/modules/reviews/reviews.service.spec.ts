import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ReviewsService } from './reviews.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';

describe('ReviewsService (Issue #173) — edit/delete/admin', () => {
  let service: ReviewsService;

  const existingReview = {
    id: 'rev1',
    courseId: 'course1',
    studentId: 'student1',
    rating: 4,
    comment: 'Good course',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrisma = {
    course: { findUnique: jest.fn().mockResolvedValue({ id: 'course1' }), update: jest.fn() },
    courseReview: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 4 }, _count: { _all: 1 } }),
    },
    $transaction: jest.fn(),
  };

  const mockEnrollments = { isEnrolled: jest.fn().mockResolvedValue(true) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EnrollmentsService, useValue: mockEnrollments },
      ],
    }).compile();

    service = module.get<ReviewsService>(ReviewsService);
    jest.clearAllMocks();
  });

  it('should update own review', async () => {
    mockPrisma.courseReview.findUnique.mockResolvedValue(existingReview);
    mockPrisma.courseReview.update.mockResolvedValue({ ...existingReview, rating: 5 });

    const result = await service.updateMyReview('student1', 'course1', { rating: 5 });
    expect(result.rating).toBe(5);
  });

  it('should reject update from non-owner (403)', async () => {
    mockPrisma.courseReview.findUnique.mockResolvedValue(existingReview);

    await expect(
      service.updateMyReview('other-student', 'course1', { rating: 3 }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should delete own review', async () => {
    mockPrisma.courseReview.findUnique.mockResolvedValue(existingReview);
    mockPrisma.courseReview.delete.mockResolvedValue(existingReview);

    const result = await service.deleteMyReview('student1', 'course1');
    expect(result.message).toBe('Review deleted');
  });

  it('should reject delete from non-owner (403)', async () => {
    mockPrisma.courseReview.findUnique.mockResolvedValue(existingReview);

    await expect(
      service.deleteMyReview('other-student', 'course1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should 404 on delete if review not found', async () => {
    mockPrisma.courseReview.findUnique.mockResolvedValue(null);

    await expect(
      service.deleteMyReview('student1', 'course1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('admin should delete any review by id', async () => {
    mockPrisma.courseReview.findUnique.mockResolvedValue(existingReview);
    mockPrisma.courseReview.delete.mockResolvedValue(existingReview);

    const result = await service.adminDeleteReview('rev1');
    expect(result.message).toBe('Review deleted by admin');
  });

  it('admin delete should 404 if review not found', async () => {
    mockPrisma.courseReview.findUnique.mockResolvedValue(null);

    await expect(service.adminDeleteReview('nonexistent')).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// Issue #50 — enrollment-gated create paths
// ---------------------------------------------------------------------------
describe('ReviewsService — enrollment-gated create (Issue #50)', () => {
  let service: ReviewsService;

  const mockPrisma = {
    course: { findUnique: jest.fn(), update: jest.fn() },
    courseReview: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 4 }, _count: { _all: 1 } }),
    },
    $transaction: jest.fn(),
  };

  const mockEnrollments = { isEnrolled: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EnrollmentsService, useValue: mockEnrollments },
      ],
    }).compile();
    service = module.get<ReviewsService>(ReviewsService);
    jest.clearAllMocks();
    mockPrisma.course.findUnique.mockResolvedValue({ id: 'course1' });
  });

  it('throws ForbiddenException when student is not enrolled', async () => {
    mockEnrollments.isEnrolled.mockResolvedValue(false);
    await expect(
      service.create('student1', 'course1', { rating: 5, comment: 'Great' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('creates a review when student is enrolled', async () => {
    mockEnrollments.isEnrolled.mockResolvedValue(true);
    mockPrisma.courseReview.findUnique.mockResolvedValue(null);
    const newReview = { id: 'rev2', courseId: 'course1', studentId: 'student1', rating: 5, comment: 'Great' };
    mockPrisma.courseReview.create.mockResolvedValue(newReview);
    mockPrisma.courseReview.aggregate.mockResolvedValue({ _avg: { rating: 5 }, _count: { _all: 1 } });
    mockPrisma.course.update.mockResolvedValue({});

    const result = await service.create('student1', 'course1', { rating: 5, comment: 'Great' });
    expect(result).toMatchObject({ rating: 5, courseId: 'course1' });
  });

  it('throws ConflictException when student already reviewed the course', async () => {
    mockEnrollments.isEnrolled.mockResolvedValue(true);
    mockPrisma.courseReview.findUnique.mockResolvedValue({ id: 'existing-rev' });
    await expect(
      service.create('student1', 'course1', { rating: 4, comment: 'Good' }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException when course does not exist', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(null);
    await expect(
      service.create('student1', 'no-course', { rating: 4, comment: 'Good' }),
    ).rejects.toThrow(NotFoundException);
  });
});
