import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BadgeRequirementType, UserRole } from '@prisma/client';
import { BadgesService } from './badges.service';
import { PrismaService } from '../../common/prisma/prisma.service';

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const mockEnrollment = {
  findMany: jest.fn(),
  count: jest.fn(),
};

const mockStudentBadge = {
  findMany: jest.fn(),
  createMany: jest.fn(),
};

const mockBadge = {
  findMany: jest.fn(),
  findUnique: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  upsert: jest.fn(),
};

const mockUser = {
  findUnique: jest.fn(),
};

const mockUserPoints = {
  findUnique: jest.fn(),
};

// A transaction client that exposes the same mocks.
const txClient = {
  badge: mockBadge,
  studentBadge: mockStudentBadge,
  enrollment: mockEnrollment,
  userPoints: mockUserPoints,
};

const mockPrisma = {
  badge: mockBadge,
  studentBadge: mockStudentBadge,
  enrollment: mockEnrollment,
  user: mockUser,
  userPoints: mockUserPoints,
  $transaction: jest.fn((fn: (tx: typeof txClient) => unknown) => fn(txClient)),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBadge(overrides: Partial<{
  id: string;
  requirementType: BadgeRequirementType;
  requirementValue: number;
  isActive: boolean;
}> = {}) {
  return {
    id: overrides.id ?? 'badge-1',
    code: 'TEST',
    name: 'Test Badge',
    description: null,
    iconUrl: null,
    requirementType: overrides.requirementType ?? BadgeRequirementType.LESSONS_COMPLETED,
    requirementValue: overrides.requirementValue ?? 5,
    isActive: overrides.isActive ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BadgesService (Issue #15)', () => {
  let service: BadgesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BadgesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(BadgesService);
    jest.clearAllMocks();

    // Default: $transaction runs the callback against txClient.
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof txClient) => unknown) => fn(txClient),
    );
    mockStudentBadge.createMany.mockResolvedValue({ count: 0 });
  });

  describe('handleMilestoneEvent — guard clauses', () => {
    it('throws NotFoundException for an unknown studentId', async () => {
      mockUser.findUnique.mockResolvedValue(null);

      await expect(
        service.handleMilestoneEvent('unknown', { type: BadgeRequirementType.LESSONS_COMPLETED }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for a non-STUDENT user', async () => {
      mockUser.findUnique.mockResolvedValue({ id: 'u1', role: UserRole.INSTRUCTOR });

      await expect(
        service.handleMilestoneEvent('u1', { type: BadgeRequirementType.LESSONS_COMPLETED }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('handleMilestoneEvent — LESSONS_COMPLETED', () => {
    const studentId = 's1';

    beforeEach(() => {
      mockUser.findUnique.mockResolvedValue({ id: studentId, role: UserRole.STUDENT });
    });

    it('calls enrollment.findMany exactly once even when three LESSONS_COMPLETED badges exist', async () => {
      const badges = [
        makeBadge({ id: 'b1', requirementValue: 1 }),
        makeBadge({ id: 'b2', requirementValue: 3 }),
        makeBadge({ id: 'b3', requirementValue: 5 }),
      ];
      mockBadge.findMany.mockResolvedValue(badges);
      mockStudentBadge.findMany.mockResolvedValue([]);

      // Student has 5 completed lessons across two enrollments.
      mockEnrollment.findMany.mockResolvedValue([
        { lessonProgress: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }] },
        { lessonProgress: [{ id: 'l4' }, { id: 'l5' }] },
      ]);

      await service.handleMilestoneEvent(studentId, { type: BadgeRequirementType.LESSONS_COMPLETED });

      expect(mockEnrollment.findMany).toHaveBeenCalledTimes(1);
    });

    it('awards all three badges when the student meets every threshold', async () => {
      const badges = [
        makeBadge({ id: 'b1', requirementValue: 1 }),
        makeBadge({ id: 'b2', requirementValue: 3 }),
        makeBadge({ id: 'b3', requirementValue: 5 }),
      ];
      mockBadge.findMany.mockResolvedValue(badges);
      mockStudentBadge.findMany.mockResolvedValue([]);
      mockEnrollment.findMany.mockResolvedValue([
        { lessonProgress: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }, { id: 'l4' }, { id: 'l5' }] },
      ]);

      const result = await service.handleMilestoneEvent(studentId, {
        type: BadgeRequirementType.LESSONS_COMPLETED,
      });

      expect(result.totalAwarded).toBe(3);
      expect(result.awarded).toHaveLength(3);
    });

    it('does not re-award already-earned badges and totalAwarded reflects only new ones', async () => {
      const badges = [
        makeBadge({ id: 'b1', requirementValue: 1 }),
        makeBadge({ id: 'b2', requirementValue: 3 }),
        makeBadge({ id: 'b3', requirementValue: 5 }),
      ];
      mockBadge.findMany.mockResolvedValue(badges);
      // Student already holds b1 and b2.
      mockStudentBadge.findMany.mockResolvedValue([
        { badgeId: 'b1' },
        { badgeId: 'b2' },
      ]);
      mockEnrollment.findMany.mockResolvedValue([
        { lessonProgress: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }, { id: 'l4' }, { id: 'l5' }] },
      ]);

      const result = await service.handleMilestoneEvent(studentId, {
        type: BadgeRequirementType.LESSONS_COMPLETED,
      });

      expect(result.totalAwarded).toBe(1);
      expect(result.awarded[0].id).toBe('b3');
    });
  });
});
  });
});
