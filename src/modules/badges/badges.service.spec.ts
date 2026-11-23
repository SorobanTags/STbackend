import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BadgeRequirementType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BadgesService } from './badges.service';

describe('BadgesService.updateBadge', () => {
  let service: BadgesService;

  const mockBadge = {
    id: 'badge-1',
    code: 'FIRST_LESSON',
    name: 'First Lesson',
    description: null,
    iconUrl: null,
    requirementType: BadgeRequirementType.LESSONS_COMPLETED,
    requirementValue: 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrisma = {
    badge: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    studentBadge: {
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BadgesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BadgesService>(BadgesService);
    jest.clearAllMocks();
  });

  it('throws BadRequestException when requirementType changes and students have earned the badge', async () => {
    mockPrisma.badge.findUnique.mockResolvedValue(mockBadge);
    mockPrisma.studentBadge.count.mockResolvedValue(3);

    await expect(
      service.updateBadge('badge-1', {
        requirementType: BadgeRequirementType.COURSES_COMPLETED,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mockPrisma.studentBadge.count).toHaveBeenCalledWith({
      where: { badgeId: 'badge-1' },
    });
  });

  it('succeeds when requirementType changes and no student has earned the badge', async () => {
    const updated = { ...mockBadge, requirementType: BadgeRequirementType.COURSES_COMPLETED };
    mockPrisma.badge.findUnique.mockResolvedValue(mockBadge);
    mockPrisma.studentBadge.count.mockResolvedValue(0);
    mockPrisma.badge.update.mockResolvedValue(updated);

    const result = await service.updateBadge('badge-1', {
      requirementType: BadgeRequirementType.COURSES_COMPLETED,
    });

    expect(result.requirementType).toBe(BadgeRequirementType.COURSES_COMPLETED);
    expect(mockPrisma.badge.update).toHaveBeenCalled();
  });

  it('never queries studentBadge when updating only name or isActive', async () => {
    const updated = { ...mockBadge, name: 'Renamed', isActive: false };
    mockPrisma.badge.findUnique.mockResolvedValue(mockBadge);
    mockPrisma.badge.update.mockResolvedValue(updated);

    await service.updateBadge('badge-1', { name: 'Renamed', isActive: false });

    expect(mockPrisma.studentBadge.count).not.toHaveBeenCalled();
    expect(mockPrisma.badge.update).toHaveBeenCalled();
  });

  it('throws NotFoundException when badge does not exist', async () => {
    mockPrisma.badge.findUnique.mockResolvedValue(null);

    await expect(
      service.updateBadge('nonexistent', { name: 'New Name' }),
    ).rejects.toThrow(NotFoundException);
  });
});
