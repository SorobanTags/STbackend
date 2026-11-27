import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StellarService } from '../stellar/stellar.service';
import { RefundStatus } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2024-06-15T12:00:00.000Z');

const STUDENT_ID = 'student-1';
const OTHER_STUDENT_ID = 'student-2';
const ENROLLMENT_ID = 'enrollment-1';

function buildEnrollment(overrides: Record<string, any> = {}) {
  return {
    id: ENROLLMENT_ID,
    studentId: STUDENT_ID,
    amountPaid: 1000,
    refundedAt: null,
    course: { id: 'course-1', title: 'Course' },
    ...overrides,
  };
}

describe('RefundsService', () => {
  let service: RefundsService;
  let mockPrisma: any;
  let mockStellar: any;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(NOW);

    mockPrisma = {
      enrollment: {
        findUnique: jest.fn(),
      },
      refund: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    mockStellar = {
      processRefund: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StellarService, useValue: mockStellar },
      ],
    }).compile();

    service = module.get<RefundsService>(RefundsService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('throws NotFound when the enrollment does not exist', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(
        service.create(STUDENT_ID, {
          enrollmentId: ENROLLMENT_ID,
          requestedAmount: 100,
          reason: 'test',
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Forbidden when the enrollment belongs to another student', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(
        buildEnrollment({ studentId: OTHER_STUDENT_ID }),
      );

      await expect(
        service.create(STUDENT_ID, {
          enrollmentId: ENROLLMENT_ID,
          requestedAmount: 100,
          reason: 'test',
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws Conflict when the enrollment was already refunded', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(
        buildEnrollment({ refundedAt: new Date(NOW.getTime() - DAY_MS) }),
      );

      await expect(
        service.create(STUDENT_ID, {
          enrollmentId: ENROLLMENT_ID,
          requestedAmount: 100,
          reason: 'test',
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it.each([RefundStatus.PENDING, RefundStatus.APPROVED])(
      'throws Conflict when a %s refund request is already in flight',
      async (status) => {
        mockPrisma.enrollment.findUnique.mockResolvedValue(buildEnrollment());
        mockPrisma.refund.findFirst.mockResolvedValue({
          id: 'refund-1',
          status,
        });

        await expect(
          service.create(STUDENT_ID, {
            enrollmentId: ENROLLMENT_ID,
            requestedAmount: 100,
            reason: 'test',
          } as any),
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );

    it('throws BadRequest when the eligibility window has expired', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(
        buildEnrollment({
          createdAt: new Date(NOW.getTime() - 365 * DAY_MS),
        }),
      );
      mockPrisma.refund.findFirst.mockResolvedValue(null);

      await expect(
        service.create(STUDENT_ID, {
          enrollmentId: ENROLLMENT_ID,
          requestedAmount: 100,
          reason: 'test',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequest when the requested amount exceeds the amount paid', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(buildEnrollment());
      mockPrisma.refund.findFirst.mockResolvedValue(null);

      await expect(
        service.create(STUDENT_ID, {
          enrollmentId: ENROLLMENT_ID,
          requestedAmount: 5000,
          reason: 'test',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates a full refund with isPartial false when the full amount is requested', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(buildEnrollment());
      mockPrisma.refund.findFirst.mockResolvedValue(null);
      mockPrisma.refund.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'refund-1', ...data }),
      );

      const result = await service.create(STUDENT_ID, {
        enrollmentId: ENROLLMENT_ID,
        requestedAmount: 1000,
        reason: 'test',
      } as any);

      expect(mockPrisma.refund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isPartial: false }),
        }),
      );
      expect(result).toEqual(expect.objectContaining({ isPartial: false }));
    });

    it('creates a partial refund with isPartial true when less than the full amount is requested', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(buildEnrollment());
      mockPrisma.refund.findFirst.mockResolvedValue(null);
      mockPrisma.refund.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'refund-1', ...data }),
      );

      const result = await service.create(STUDENT_ID, {
        enrollmentId: ENROLLMENT_ID,
        requestedAmount: 250,
        reason: 'test',
      } as any);

      expect(mockPrisma.refund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isPartial: true }),
        }),
      );
      expect(result).toEqual(expect.objectContaining({ isPartial: true }));
    });
  });
});
