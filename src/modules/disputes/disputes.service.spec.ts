import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DisputeReferenceType } from '@prisma/client';
import { DisputesService } from './disputes.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DisputesService.validateReference', () => {
  let service: DisputesService;
  let prisma: {
    enrollment: { findUnique: jest.Mock };
    payment: { findUnique: jest.Mock };
    assignment: { findUnique: jest.Mock };
    dispute: { create: jest.Mock };
  };

  const callerId = 'caller-user-id';
  const otherId = 'other-user-id';
  const referenceId = 'reference-id';

  beforeEach(async () => {
    prisma = {
      enrollment: { findUnique: jest.fn() },
      payment: { findUnique: jest.fn() },
      assignment: { findUnique: jest.fn() },
      dispute: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DisputesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<DisputesService>(DisputesService);
  });

  const cases: Array<{
    type: DisputeReferenceType;
    model: 'enrollment' | 'payment' | 'assignment';
    owned: Record<string, unknown>;
    notOwned: Record<string, unknown>;
  }> = [
    {
      type: DisputeReferenceType.ENROLLMENT,
      model: 'enrollment',
      owned: { id: referenceId, studentId: callerId },
      notOwned: { id: referenceId, studentId: otherId },
    },
    {
      type: DisputeReferenceType.PAYMENT,
      model: 'payment',
      owned: { id: referenceId, studentId: callerId },
      notOwned: { id: referenceId, studentId: otherId },
    },
    {
      type: DisputeReferenceType.ASSIGNMENT,
      model: 'assignment',
      owned: { id: referenceId, studentId: callerId },
      notOwned: { id: referenceId, studentId: otherId },
    },
  ];

  describe.each(cases)('$type', ({ type, model, owned, notOwned }) => {
    it('passes when the record is owned by the caller', async () => {
      prisma[model].findUnique.mockResolvedValue(owned);

      await expect(
        service.validateReference(callerId, type, referenceId),
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenException when the record is owned by another user', async () => {
      prisma[model].findUnique.mockResolvedValue(notOwned);

      await expect(
        service.validateReference(callerId, type, referenceId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException when the record does not exist', async () => {
      prisma[model].findUnique.mockResolvedValue(null);

      await expect(
        service.validateReference(callerId, type, referenceId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('file()', () => {
    it('does not create a dispute when validateReference throws', async () => {
      prisma.enrollment.findUnique.mockResolvedValue({
        id: referenceId,
        studentId: otherId,
      });

      await expect(
        service.file(callerId, {
          referenceType: DisputeReferenceType.ENROLLMENT,
          referenceId,
          subject: 'Subject',
          description: 'Description',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.dispute.create).not.toHaveBeenCalled();
    });
  });
});
