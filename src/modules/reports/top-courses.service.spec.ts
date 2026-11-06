import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EnrollmentStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  TopCoursesMetric,
  TopCoursesQueryDto,
  TopCoursesWindow,
} from './dto/top-courses-query.dto';
import { TopCoursesService } from './top-courses.service';

describe('TopCoursesService', () => {
  const mockPrisma = {
    enrollment: { groupBy: jest.fn() },
    course: { findMany: jest.fn() },
  };
  let service: TopCoursesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.enrollment.groupBy.mockResolvedValue([
      { courseId: 'course-1', _count: { _all: 5 } },
    ]);
    mockPrisma.course.findMany.mockResolvedValue([
      {
        id: 'course-1',
        title: 'Soroban Basics',
        category: 'Blockchain',
        level: 'BEGINNER',
        instructorAddress: 'GInstructor',
        price: 25,
        status: 'ACTIVE',
        thumbnailUrl: null,
      },
    ]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopCoursesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(TopCoursesService);
  });

  it('ranks courses by enrollment count using the requested window and limit', async () => {
    const result = await service.getTopCourses({
      metric: TopCoursesMetric.ENROLLMENTS,
      window: TopCoursesWindow.LAST_7_DAYS,
      limit: 5,
    });

    expect(result).toEqual({
      metric: TopCoursesMetric.ENROLLMENTS,
      window: TopCoursesWindow.LAST_7_DAYS,
      limit: 5,
      data: [
        {
          rank: 1,
          course: expect.objectContaining({ id: 'course-1' }),
          metric: TopCoursesMetric.ENROLLMENTS,
          metricValue: 5,
        },
      ],
    });
    expect(mockPrisma.enrollment.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['courseId'],
        where: expect.objectContaining({
          status: { not: EnrollmentStatus.REFUNDED },
          enrolledAt: { gte: expect.any(Date) },
        }),
        take: 5,
      }),
    );
  });

  it('calculates completion rates from completed and total enrollments', async () => {
    mockPrisma.enrollment.groupBy.mockResolvedValue([
      { courseId: 'course-1', status: EnrollmentStatus.COMPLETED, _count: { _all: 3 } },
      { courseId: 'course-1', status: EnrollmentStatus.ACTIVE, _count: { _all: 5 } },
    ]);

    const result = await service.getTopCourses({
      metric: TopCoursesMetric.COMPLETION_RATE,
    });

    expect(result.data[0].metricValue).toBe(37.5);
    expect(mockPrisma.enrollment.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['courseId', 'status'] }),
    );
  });

  it('rejects unsupported metrics', async () => {
    await expect(
      service.getTopCourses(
        Object.assign(new TopCoursesQueryDto(), { metric: 'UNSUPPORTED' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});