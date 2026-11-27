import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UserRole, CourseStatus, EnrollmentStatus } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';

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

    service = module.get<DashboardService>(DashboardService);
    jest.clearAllMocks();
  });

  describe('validateDateRange (via getSummary)', () => {
    // We test the private method indirectly through getSummary. When validation
    // throws we never reach the Prisma calls, so no mocking is needed there.

    it('should accept when both bounds are missing', async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.course.count.mockResolvedValue(0);
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.enrollment.aggregate.mockResolvedValue({ _sum: { amountPaid: null } });

      // No dates — hits the cache branch which also calls computeSummary.
      await expect(service.getSummary({})).resolves.toBeDefined();
    });

    it('should throw when only startDate is supplied', async () => {
      await expect(
        service.getSummary({ startDate: '2024-01-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when only endDate is supplied', async () => {
      await expect(
        service.getSummary({ endDate: '2024-01-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw for an invalid ISO startDate', async () => {
      await expect(
        service.getSummary({ startDate: 'not-a-date', endDate: '2024-01-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw for an invalid ISO endDate', async () => {
      await expect(
        service.getSummary({ startDate: '2024-01-01', endDate: 'not-a-date' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when startDate is after endDate', async () => {
      await expect(
        service.getSummary({ startDate: '2024-06-01', endDate: '2024-01-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept an endDate equal to the current instant', async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.course.count.mockResolvedValue(0);
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.enrollment.aggregate.mockResolvedValue({ _sum: { amountPaid: null } });

      const now = new Date().toISOString();
      await expect(
        service.getSummary({ startDate: '2020-01-01', endDate: now }),
      ).resolves.toBeDefined();
    });

    it('should reject an endDate clearly in the future', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await expect(
        service.getSummary({ startDate: '2024-01-01', endDate: tomorrow }),
      ).rejects.toThrow(BadRequestException);
    });
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
  });
});
