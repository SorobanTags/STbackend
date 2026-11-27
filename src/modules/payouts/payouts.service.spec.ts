import { Test, TestingModule } from '@nestjs/testing';
import { PayoutsService } from './payouts.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { KycService } from '../kyc/kyc.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PayoutStatus, UserRole } from '@prisma/client';

describe('PayoutsService', () => {
  let service: PayoutsService;

  const mockPrisma = {
    user: { findUnique: jest.fn() },
    payout: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockKyc = {
    getVerificationStatus: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: KycService, useValue: mockKyc },
      ],
    }).compile();

    service = module.get<PayoutsService>(PayoutsService);
    jest.clearAllMocks();
  });

  it('should prevent non-owners and non-admins from viewing payout history', async () => {
    const requestingUser = { id: 'user-2', role: UserRole.STUDENT };
    await expect(
      service.getInstructorPayoutHistory(requestingUser, 'instructor-1', {}),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should return payout history for requesting instructor', async () => {
    const requestingUser = { id: 'instructor-1', role: UserRole.INSTRUCTOR };
    const payouts = [
      {
        id: 'pay-1',
        instructorId: 'instructor-1',
        amount: 150.0,
        status: PayoutStatus.COMPLETED,
      },
    ];

    mockPrisma.$transaction.mockResolvedValue([payouts, 1]);

    const res = await service.getInstructorPayoutHistory(
      requestingUser,
      'instructor-1',
      {},
    );

    expect(res.data).toHaveLength(1);
    expect(res.meta.total).toBe(1);
  });

  it('should track payout status transitions', async () => {
    mockPrisma.payout.findUnique.mockResolvedValue({
      id: 'pay-1',
      status: PayoutStatus.PENDING,
      txHash: null,
    });
    mockPrisma.payout.update.mockResolvedValue({
      id: 'pay-1',
      status: PayoutStatus.COMPLETED,
      txHash: '0x123',
    });

    const res = await service.updatePayoutStatus('pay-1', {
      status: PayoutStatus.COMPLETED,
      txHash: '0x123',
    });

    expect(res.status).toBe(PayoutStatus.COMPLETED);
    expect(res.txHash).toBe('0x123');
  });

  describe('createPayout KYC gate', () => {
    const dto: any = { instructorId: 'instructor-1', amount: 100 };

    it('should reject payout creation for an unverified instructor', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'instructor-1' });
      mockKyc.getVerificationStatus.mockResolvedValue({
        isVerified: false,
        status: 'PENDING',
        adminNotes: null,
        reviewedAt: null,
      });

      await expect(service.createPayout(dto)).rejects.toThrow(ForbiddenException);
      expect(mockKyc.getVerificationStatus).toHaveBeenCalledWith('instructor-1');
      expect(mockPrisma.payout.create).not.toHaveBeenCalled();
    });

    it('should reject payout creation when no KYC submission exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'instructor-1' });
      mockKyc.getVerificationStatus.mockResolvedValue({
        isVerified: false,
        status: null,
        adminNotes: null,
        reviewedAt: null,
      });

      await expect(service.createPayout(dto)).rejects.toThrow(
        /KYC/i,
      );
      expect(mockPrisma.payout.create).not.toHaveBeenCalled();
    });

    it('should create a payout for a KYC-verified instructor', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'instructor-1' });
      mockKyc.getVerificationStatus.mockResolvedValue({
        isVerified: true,
        status: 'APPROVED',
        adminNotes: null,
        reviewedAt: new Date(),
      });
      mockPrisma.payout.create.mockResolvedValue({
        id: 'pay-1',
        instructorId: 'instructor-1',
        amount: 100,
        status: PayoutStatus.PENDING,
      });

      const res = await service.createPayout(dto);

      expect(res.id).toBe('pay-1');
      expect(mockPrisma.payout.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException when the instructor does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.createPayout(dto)).rejects.toThrow(NotFoundException);
      expect(mockKyc.getVerificationStatus).not.toHaveBeenCalled();
    });
  });

  describe('createPayout — idempotency window', () => {
    const baseDto: any = {
      instructorId: 'instructor-1',
      amount: 200,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
    };
    const existingPayout = {
      id: 'pay-existing',
      instructorId: 'instructor-1',
      amount: 200,
      status: PayoutStatus.PENDING,
      idempotencyKey: 'payout:instructor-1:2024-01-01:2024-01-31',
      createdAt: new Date(),
    };

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns the existing payout without calling create when duplicate key is inside the window', async () => {
      jest.setSystemTime(new Date('2024-02-01T12:00:00Z'));
      // existing payout created 1 hour ago — well inside the 24h window
      const createdAt = new Date('2024-02-01T11:00:00Z');
      mockPrisma.payout.findFirst.mockResolvedValue({ ...existingPayout, createdAt });

      const result = await (service as any).createPayout(baseDto);

      expect(result.id).toBe('pay-existing');
      expect(mockPrisma.payout.create).not.toHaveBeenCalled();
    });

    it('creates a new payout when the duplicate key is outside the 24h window', async () => {
      jest.setSystemTime(new Date('2024-02-03T12:00:00Z'));
      // findFirst returns null — outside the window (the gte filter would exclude old rows)
      mockPrisma.payout.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'instructor-1' });
      mockKyc.getVerificationStatus.mockResolvedValue({ isVerified: true });
      mockPrisma.payout.create.mockResolvedValue({
        id: 'pay-new',
        ...baseDto,
        status: PayoutStatus.PENDING,
      });

      const result = await (service as any).createPayout(baseDto);

      expect(result.id).toBe('pay-new');
      expect(mockPrisma.payout.create).toHaveBeenCalledTimes(1);
    });

    it('derives the idempotency key from instructorId, periodStart and periodEnd when no key is supplied', async () => {
      mockPrisma.payout.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'instructor-1' });
      mockKyc.getVerificationStatus.mockResolvedValue({ isVerified: true });
      mockPrisma.payout.create.mockResolvedValue({
        id: 'pay-derived',
        idempotencyKey: 'payout:instructor-1:2024-01-01:2024-01-31',
        status: PayoutStatus.PENDING,
      });

      await (service as any).createPayout(baseDto);

      expect(mockPrisma.payout.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            idempotencyKey: 'payout:instructor-1:2024-01-01:2024-01-31',
          }),
        }),
      );
    });
  });

  describe('exportPayoutStatement — aggregation', () => {
    const requestingUser = { id: 'instructor-1', role: UserRole.INSTRUCTOR };

    it('buckets amounts correctly by PayoutStatus', async () => {
      const payouts = [
        { id: 'p1', amount: '100', status: PayoutStatus.COMPLETED },
        { id: 'p2', amount: '200', status: PayoutStatus.COMPLETED },
        { id: 'p3', amount: '50', status: PayoutStatus.PENDING },
        { id: 'p4', amount: '75', status: PayoutStatus.PROCESSING },
        { id: 'p5', amount: '30', status: PayoutStatus.FAILED },
      ];

      mockPrisma.$transaction.mockResolvedValue([payouts, payouts.length]);

      const result = await service.exportPayoutStatement(
        requestingUser,
        'instructor-1',
        {},
      );

      expect(result.summary.totalCompletedAmount).toBe(300);
      expect(result.summary.totalPendingAmount).toBe(125);
      // FAILED is neither completed nor pending
      expect(result.summary.totalCompletedAmount + result.summary.totalPendingAmount).toBe(425);
    });
  });
});
