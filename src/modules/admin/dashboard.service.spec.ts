import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const mockPrisma = {
  user: { count: jest.fn() },
  course: { count: jest.fn() },
  enrollment: { count: jest.fn(), aggregate: jest.fn() },
};

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrisma },
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
});
