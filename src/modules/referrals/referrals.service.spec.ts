import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReferralsService } from './referrals.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  DiscountType,
  ReferralRewardKind,
  ReferralRewardStatus,
  ReferralStatus,
} from '@prisma/client';

describe('ReferralsService', () => {
  let service: ReferralsService;

  const mockPrisma: any = {
    user: { findUnique: jest.fn() },
    referralCode: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    referral: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    referralReward: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    referralRewardRule: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockNotifications = {
    notifyUser: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn((key: string, defaultValue?: number) => {
      const defaults: Record<string, number> = {
        REFERRAL_REFERRER_DISCOUNT_PERCENT: 10,
        REFERRAL_REFEREE_DISCOUNT_PERCENT: 10,
        REFERRAL_REWARD_EXPIRY_DAYS: 90,
        REFERRAL_MAX_REWARDS_PER_REFERRER: 50,
      };
      return defaults[key] ?? defaultValue;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReferralsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<ReferralsService>(ReferralsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDefaultRules', () => {
    it('returns the configured values when env vars are valid', () => {
      const rules = (service as any).getDefaultRules();

      expect(rules).toEqual({
        referrerDiscountPercent: 10,
        refereeDiscountPercent: 10,
        rewardExpiryDays: 90,
        maxRewardsPerReferrer: 50,
      });
    });

    it('falls back to hardcoded defaults when env vars are malformed', () => {
      mockConfig.get.mockImplementation((key: string, defaultValue?: number) => {
        const malformed: Record<string, any> = {
          REFERRAL_REFERRER_DISCOUNT_PERCENT: 'not-a-number',
          REFERRAL_REFEREE_DISCOUNT_PERCENT: '150',
          REFERRAL_REWARD_EXPIRY_DAYS: '-5',
          REFERRAL_MAX_REWARDS_PER_REFERRER: 'NaN',
        };
        return malformed[key] ?? defaultValue;
      });

      const rules = (service as any).getDefaultRules();

      expect(rules).toEqual({
        referrerDiscountPercent: 10,
        refereeDiscountPercent: 10,
        rewardExpiryDays: 90,
        maxRewardsPerReferrer: 50,
      });
    });
  });

  describe('updateRewardRules', () => {
    it('persists valid merged rules', async () => {
      mockPrisma.referralRewardRule.findUnique.mockResolvedValue({
        id: 'rules-1',
        referrerDiscountPercent: 10,
        refereeDiscountPercent: 10,
        rewardExpiryDays: 90,
        maxRewardsPerReferrer: 50,
      });
      mockPrisma.referralRewardRule.upsert.mockResolvedValue({
        id: 'rules-1',
        referrerDiscountPercent: 15,
        refereeDiscountPercent: 10,
        rewardExpiryDays: 90,
        maxRewardsPerReferrer: 50,
      });

      const result = await service.updateRewardRules({ referrerDiscountPercent: 15 });

      expect(result.referrerDiscountPercent).toBe(15);
      expect(mockPrisma.referralRewardRule.upsert).toHaveBeenCalled();
    });

    it('throws BadRequestException when merged rules fall out of range', async () => {
      mockPrisma.referralRewardRule.findUnique.mockResolvedValue({
        id: 'rules-1',
        referrerDiscountPercent: 10,
        refereeDiscountPercent: 10,
        rewardExpiryDays: 90,
        maxRewardsPerReferrer: 50,
      });

      await expect(
        service.updateRewardRules({ referrerDiscountPercent: 150 }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.referralRewardRule.upsert).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when a stored row is already out of range', async () => {
      mockPrisma.referralRewardRule.findUnique.mockResolvedValue({
        id: 'rules-1',
        referrerDiscountPercent: 10,
        refereeDiscountPercent: 10,
        rewardExpiryDays: -1,
        maxRewardsPerReferrer: 50,
      });

      await expect(
        service.updateRewardRules({ referrerDiscountPercent: 20 }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.referralRewardRule.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getOrCreateCode', () => {
    it('returns existing code without creating a new one', async () => {
      const existing = { id: 'rc-1', userId: 'u-1', code: 'HAMP-ABC123', isActive: true };
      mockPrisma.referralCode.findUnique.mockResolvedValue(existing);

      const result = await service.getOrCreateCode('u-1');

      expect(result).toEqual(existing);
      expect(mockPrisma.referralCode.create).not.toHaveBeenCalled();
    });

    it('generates a new unique referral code when none exists', async () => {
      mockPrisma.referralCode.findUnique
        .mockResolvedValueOnce(null) // getOrCreateCode lookup by userId
        .mockResolvedValueOnce(null); // uniqueness check in generateUniqueCode
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1' });
      mockPrisma.referralCode.create.mockResolvedValue({
        id: 'rc-1',
        userId: 'u-1',
        code: 'HAMP-DEADBE',
        isActive: true,
      });

      const result = await service.getOrCreateCode('u-1');

      expect(mockPrisma.referralCode.create).toHaveBeenCalled();
      expect(result.userId).toBe('u-1');
      expect(result.code).toMatch(/^HAMP-/);
    });

    it('throws when user does not exist', async () => {
      mockPrisma.referralCode.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getOrCreateCode('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('validateCode', () => {
    it('validates an active referral code', async () => {
      mockPrisma.referralCode.findUnique.mockResolvedValue({
        id: 'rc-1',
        code: 'HAMP-ABC123',
        isActive: true,
        userId: 'referrer-1',
        user: { id: 'referrer-1', name: 'Ada', stellarAddress: 'GADA' },
      });

      const result = await service.validateCode('hamp-abc123');

      expect(result.valid).toBe(true);
      expect(result.code).toBe('HAMP-ABC123');
      expect(result.refereeDiscountPercent).toBe(10);
    });

    it('rejects an inactive code', async () => {
      mockPrisma.referralCode.findUnique.mockResolvedValue({
        id: 'rc-1',
        code: 'HAMP-ABC123',
        isActive: false,
        userId: 'referrer-1',
        user: { id: 'referrer-1', name: 'Ada', stellarAddress: 'GADA' },
      });

      await expect(service.validateCode('HAMP-ABC123')).rejects.toThrow(BadRequestException);
    });

    it('rejects self-referral', async () => {
      mockPrisma.referralCode.findUnique.mockResolvedValue({
        id: 'rc-1',
        code: 'HAMP-ABC123',
        isActive: true,
        userId: 'u-1',
        user: { id: 'u-1', name: 'Ada', stellarAddress: 'GADA' },
      });

      await expect(service.validateCode('HAMP-ABC123', 'u-1')).rejects.toThrow(BadRequestException);
    });

    it('throws when code is not found', async () => {
      mockPrisma.referralCode.findUnique.mockResolvedValue(null);
      await expect(service.validateCode('NOPE')).rejects.toThrow(NotFoundException);
    });
  });

  describe('trackSignup', () => {
    it('tracks signup and issues referee reward', async () => {
      mockPrisma.referral.findUnique.mockResolvedValue(null);
      mockPrisma.referralCode.findUnique.mockResolvedValue({
        id: 'rc-1',
        code: 'HAMP-ABC123',
        isActive: true,
        userId: 'referrer-1',
      });

      const createdReferral = {
        id: 'ref-1',
        referralCodeId: 'rc-1',
        referrerId: 'referrer-1',
        referredUserId: 'new-user',
        status: ReferralStatus.SIGNED_UP,
      };

      mockPrisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          referral: {
            create: jest.fn().mockResolvedValue(createdReferral),
          },
          referralCode: {
            update: jest.fn().mockResolvedValue({}),
          },
          referralReward: {
            create: jest.fn().mockResolvedValue({}),
          },
        }),
      );

      const result = await service.trackSignup('new-user', 'HAMP-ABC123');

      expect(result.id).toBe('ref-1');
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('rejects duplicate referral for the same user', async () => {
      mockPrisma.referral.findUnique.mockResolvedValue({ id: 'ref-1' });
      await expect(service.trackSignup('new-user', 'HAMP-ABC123')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('trackConversion', () => {
    it('returns null when user was not referred', async () => {
      mockPrisma.referral.findUnique.mockResolvedValue(null);
      const result = await service.trackConversion('user-x', 'enr-1');
      expect(result).toBeNull();
    });

    it('is idempotent when already converted', async () => {
      const converted = {
        id: 'ref-1',
        status: ReferralStatus.CONVERTED,
        referrerId: 'referrer-1',
        rewards: [],
      };
      mockPrisma.referral.findUnique.mockResolvedValue(converted);

      const result = await service.trackConversion('new-user', 'enr-1');
      expect(result).toEqual(converted);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('converts referral and issues referrer reward under the rules', async () => {
      mockPrisma.referral.findUnique.mockResolvedValue({
        id: 'ref-1',
        status: ReferralStatus.SIGNED_UP,
        referrerId: 'referrer-1',
        referralCodeId: 'rc-1',
        rewards: [],
      });
      mockPrisma.referralReward.count.mockResolvedValue(0);

      const updated = {
        id: 'ref-1',
        status: ReferralStatus.CONVERTED,
        enrollmentId: 'enr-1',
      };

      mockPrisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          referral: {
            update: jest.fn().mockResolvedValue(updated),
          },
          referralReward: {
            create: jest.fn().mockResolvedValue({}),
          },
        }),
      );

      const result = await service.trackConversion('new-user', 'enr-1');

      expect(result).toEqual(updated);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });
});
