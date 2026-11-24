import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UserRole, CourseStatus, EnrollmentStatus } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';

describe('DashboardService', () => {
  let service: DashboardService;

  const mockPrisma = {
    user: { count: jest.fn() },
    course: { count: jest.fn() },
    enrollment: { count: jest.fn(), aggregate: jest.fn() },
  };

  const mockCache = {
    get: jest.fn(),
    set: jest.fn(),
  };

  const zeroStats = {
    users: { total: 0, students: 0, instructors: 0, newInPeriod: 0 },
    courses: { total: 0, active: 0, pending: 0, archived: 0 },
    enrollments: { totalInPeriod: 0, completedInPeriod: 0, allTime: 0 },
    revenue: { totalInPeriod: 0, currency: 'USDC' },
  };

  function setupPrismaZero() {
    mockPrisma.user.count.mockResolvedValue(0);
    mockPrisma.course.count.mockResolvedValue(0);
    mockPrisma.enrollment.count.mockResolvedValue(0);
    mockPrisma.enrollment.aggregate.mockResolvedValue({ _sum: { amountPaid: null } });
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get(DashboardService);
  });

  describe('getSummary — no date range', () => {
    it('returns cached snapshot when one exists in the shared store', async () => {
      const calculatedAt = new Date('2026-01-01T00:00:00Z').toISOString();
      mockCache.get.mockResolvedValue({ data: zeroStats, calculatedAt });

      const result = await service.getSummary({});

      expect(mockCache.get).toHaveBeenCalledWith('admin:dashboard:summary');
      expect(result.meta.source).toBe('cache');
      expect(result.meta.calculatedAt).toEqual(new Date(calculatedAt));
      // Prisma should not be called when cache hit
      expect(mockPrisma.user.count).not.toHaveBeenCalled();
    });

    it('marks snapshot as stale when calculatedAt is older than STALE_AFTER_MS', async () => {
      const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
      mockCache.get.mockResolvedValue({ data: zeroStats, calculatedAt: old });

      const result = await service.getSummary({});

      expect(result.meta.isStale).toBe(true);
    });

    it('falls back to live computation and writes to cache when no snapshot exists', async () => {
      mockCache.get.mockResolvedValue(null);
      setupPrismaZero();
      mockCache.set.mockResolvedValue(undefined);

      const result = await service.getSummary({});

      expect(mockCache.set).toHaveBeenCalledWith(
        'admin:dashboard:summary',
        expect.objectContaining({ calculatedAt: expect.any(String) }),
        expect.any(Number),
      );
      expect(result.meta.source).toBe('cache');
    });
  });

  describe('getSummary — with date range', () => {
    it('returns source: live when start and end dates are provided', async () => {
      setupPrismaZero();

      const result = await service.getSummary({
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });

      expect(result.meta.source).toBe('live');
      expect(mockCache.get).not.toHaveBeenCalled();
    });
  });
});
