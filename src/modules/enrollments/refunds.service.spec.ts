import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EnrollmentStatus, RefundStatus } from '@prisma/client';
import { RefundsService } from './refunds.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';

describe('RefundsService.create', () => {
  let service: RefundsService;

  const mockPrisma = {
    enrollment: {
      findUnique: jest.fn(),
    },
    refundRequest: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockStellar = {};

  const baseEnrollment = {
    id: 'enrollment-1',
    studentId: 'student-1',
    status: EnrollmentStatus.ACTIVE,
    amountPaid: 500,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StellarService, useValue: mockStellar },
      ],
    }).compile();

    service = module.get<RefundsService>(RefundsService);
    jest.clearAllMocks();
  });

  it('creates a refund request for a paid, active enrollment', async () => {
    mockPrisma.enrollment.findUnique.mockResolvedValue(baseEnrollment);
    mockPrisma.refundRequest.findFirst.mockResolvedValue(null);
    mockPrisma.refundRequest.create.mockResolvedValue({
      id: 'refund-1',
      status: RefundStatus.PENDING,
    });

    const result = await service.create('student-1', {
      enrollmentId: 'enrollment-1',
      reason: 'changed my mind',
    } as any);

    expect(mockPrisma.refundRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        enrollmentId: 'enrollment-1',
        studentId: 'student-1',
        amount: 500,
        status: RefundStatus.PENDING,
      }),
    });
    expect(result).toEqual({ id: 'refund-1', status: RefundStatus.PENDING });
  });

  it('throws NotFoundException when the enrollment does not exist', async () => {
    mockPrisma.enrollment.findUnique.mockResolvedValue(null);

    await expect(
      service.create('student-1', { enrollmentId: 'missing' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ForbiddenException when the enrollment belongs to another student', async () => {
    mockPrisma.enrollment.findUnique.mockResolvedValue({
      ...baseEnrollment,
      studentId: 'other-student',
    });

    await expect(
      service.create('student-1', { enrollmentId: 'enrollment-1' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws BadRequestException when the enrollment is already refunded', async () => {
    mockPrisma.enrollment.findUnique.mockResolvedValue({
      ...baseEnrollment,
      status: EnrollmentStatus.REFUNDED,
    });

    await expect(
      service.create('student-1', { enrollmentId: 'enrollment-1' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    EnrollmentStatus.PENDING,
    EnrollmentStatus.CANCELLED,
    EnrollmentStatus.EXPIRED,
  ])('throws BadRequestException naming the status for %s enrollments', async (status) => {
    mockPrisma.enrollment.findUnique.mockResolvedValue({
      ...baseEnrollment,
      status,
    });

    await expect(
      service.create('student-1', { enrollmentId: 'enrollment-1' } as any),
    ).rejects.toThrow(status);
    expect(mockPrisma.refundRequest.create).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when the resolved amount is zero', async () => {
    mockPrisma.enrollment.findUnique.mockResolvedValue({
      ...baseEnrollment,
      amountPaid: 0,
    });
    mockPrisma.refundRequest.findFirst.mockResolvedValue(null);

    await expect(
      service.create('student-1', { enrollmentId: 'enrollment-1' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.refundRequest.create).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when the requested amount is negative', async () => {
    mockPrisma.enrollment.findUnique.mockResolvedValue(baseEnrollment);
    mockPrisma.refundRequest.findFirst.mockResolvedValue(null);

    await expect(
      service.create('student-1', {
        enrollmentId: 'enrollment-1',
        amount: -10,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.refundRequest.create).not.toHaveBeenCalled();
  });
});
