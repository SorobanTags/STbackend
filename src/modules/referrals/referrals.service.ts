import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  DiscountType,
  NotificationType,
  ReferralRewardKind,
  ReferralRewardStatus,
  ReferralStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { UpdateRewardRulesDto } from './dto/update-reward-rules.dto';

export interface ReferralRewardRules {
  referrerDiscountPercent: number;
  refereeDiscountPercent: number;
  rewardExpiryDays: number;
  maxRewardsPerReferrer: number;
}

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  /** Singleton row id used for the persisted reward-rules record. */
  private static readonly REWARD_RULES_ID = 'default';

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  // ----------------------------------------------------------
  // REWARD RULES (persisted in `referral_reward_rules`, .env fallback)
  // ----------------------------------------------------------

  /**
   * Reads a numeric env var, falling back to the hardcoded default when the
   * parsed value is not finite or falls outside the allowed range.
   */
  private readEnvNumber(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const parsed = Number(this.config.get(key, fallback));
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      this.logger.warn(
        `Invalid ${key} value; falling back to default ${fallback}`,
      );
      return fallback;
    }
    return parsed;
  }

  private getDefaultRules(): ReferralRewardRules {
    return {
      referrerDiscountPercent: this.readEnvNumber(
        'REFERRAL_REFERRER_DISCOUNT_PERCENT',
        10,
        0,
        100,
      ),
      refereeDiscountPercent: this.readEnvNumber(
        'REFERRAL_REFEREE_DISCOUNT_PERCENT',
        10,
        0,
        100,
      ),
      rewardExpiryDays: this.readEnvNumber(
        'REFERRAL_REWARD_EXPIRY_DAYS',
        90,
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      maxRewardsPerReferrer: this.readEnvNumber(
        'REFERRAL_MAX_REWARDS_PER_REFERRER',
        50,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
    };
  }

  private toRules(row: {
    referrerDiscountPercent: number;
    refereeDiscountPercent: number;
    rewardExpiryDays: number;
    maxRewardsPerReferrer: number;
  }): ReferralRewardRules {
    return {
      referrerDiscountPercent: Number(row.referrerDiscountPercent),
      refereeDiscountPercent: Number(row.refereeDiscountPercent),
      rewardExpiryDays: Number(row.rewardExpiryDays),
      maxRewardsPerReferrer: Number(row.maxRewardsPerReferrer),
    };
  }

  /**
   * Throws BadRequestException when the given rules fall outside the allowed
   * bounds. Used as a defensive guard before persisting merged rules.
   */
  private assertValidRules(rules: ReferralRewardRules): void {
    const { referrerDiscountPercent, refereeDiscountPercent } = rules;
    if (
      !Number.isFinite(referrerDiscountPercent) ||
      referrerDiscountPercent < 0 ||
      referrerDiscountPercent > 100
    ) {
      throw new BadRequestException(
        'referrerDiscountPercent must be between 0 and 100',
      );
    }
    if (
      !Number.isFinite(refereeDiscountPercent) ||
      refereeDiscountPercent < 0 ||
      refereeDiscountPercent > 100
    ) {
      throw new BadRequestException(
        'refereeDiscountPercent must be between 0 and 100',
      );
    }
    if (!Number.isFinite(rules.rewardExpiryDays) || rules.rewardExpiryDays <= 0) {
      throw new BadRequestException('rewardExpiryDays must be a positive number');
    }
    if (
      !Number.isFinite(rules.maxRewardsPerReferrer) ||
      rules.maxRewardsPerReferrer < 0
    ) {
      throw new BadRequestException(
        'maxRewardsPerReferrer must be a non-negative number',
      );
    }
  }

  async getRewardRules(): Promise<ReferralRewardRules> {
    try {
      const row = await this.prisma.referralRewardRule.findUnique({
        where: { id: ReferralsService.REWARD_RULES_ID },
      });
      if (!row) return this.getDefaultRules();
      return this.toRules(row);
    } catch (error) {
      this.logger.warn(
        `Falling back to .env referral reward rules: ${(error as Error)?.message}`,
      );
      return this.getDefaultRules();
    }
  }

  async updateRewardRules(
    dto: UpdateRewardRulesDto,
  ): Promise<ReferralRewardRules> {
    const current = await this.getRewardRules();
    const data = {
      referrerDiscountPercent:
        dto.referrerDiscountPercent ?? current.referrerDiscountPercent,
      refereeDiscountPercent:
        dto.refereeDiscountPercent ?? current.refereeDiscountPercent,
      rewardExpiryDays: dto.rewardExpiryDays ?? current.rewardExpiryDays,
      maxRewardsPerReferrer:
        dto.maxRewardsPerReferrer ?? current.maxRewardsPerReferrer,
    };
    this.assertValidRules(data);
    const row = await this.prisma.referralRewardRule.upsert({
      where: { id: ReferralsService.REWARD_RULES_ID },
      create: { id: ReferralsService.REWARD_RULES_ID, ...data },
      update: data,
    });
    const rules = this.toRules(row);
    this.logger.log(`Referral reward rules updated: ${JSON.stringify(rules)}`);
    return rules;
  }

  // ----------------------------------------------------------
  // CODE GENERATION
  // ----------------------------------------------------------

  /**
   * Returns the authenticated user's referral code, creating one if missing.
   */
  async getOrCreateCode(userId: string) {
    const existing = await this.prisma.referralCode.findUnique({
      where: { userId },
    });
    if (existing) return existing;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const code = await this.generateUniqueCode();

    const created = await this.prisma.referralCode.create({
      data: { userId, code },
    });

    this.logger.log(`Referral code generated for user ${userId}: ${code}`);
    return created;
  }

  // ----------------------------------------------------------
  // VALIDATE
  // ----------------------------------------------------------

  async validateCode(rawCode: string, requestingUserId?: string) {
    const code = rawCode.toUpperCase().trim();
    const referralCode = await this.prisma.referralCode.findUnique({
      where: { code },
      include: {
        user: { select: { id: true, name: true, stellarAddress: true } },
      },
    });

    if (!referralCode) {
      throw new NotFoundException(`Referral code "${rawCode}" not found`);
    }
    if (!referralCode.isActive) {
      throw new BadRequestException('This referral code is no longer active');
    }
    if (requestingUserId && referralCode.userId === requestingUserId) {
      throw new BadRequestException('You cannot use your own referral code');
    }

    const rules = await this.getRewardRules();

    return {
      valid: true,
      code: referralCode.code,
      referrer: {
        id: referralCode.user.id,
        name: referralCode.user.name,
      },
      refereeDiscountPercent: rules.refereeDiscountPercent,
      referrerDiscountPercent: rules.referrerDiscountPercent,
    };
  }

  // ----------------------------------------------------------
  // SIGNUP TRACKING (called from AuthService on first login)
  // ----------------------------------------------------------

  /**
   * Records a referral signup when a new user registers with a valid code.
   * Issues a pending referee welcome reward (activated on first enrollment conversion path,
   * or issued immediately so it can be applied at checkout).
   */
  async trackSignup(referredUserId: string, rawCode: string) {
    const code = rawCode.toUpperCase().trim();

    const alreadyReferred = await this.prisma.referral.findUnique({
      where: { referredUserId },
    });
    if (alreadyReferred) {
      throw new ConflictException('This user has already been referred');
    }

    const referralCode = await this.prisma.referralCode.findUnique({
      where: { code },
    });
    if (!referralCode) {
      throw new NotFoundException(`Referral code "${rawCode}" not found`);
    }
    if (!referralCode.isActive) {
      throw new BadRequestException('This referral code is no longer active');
    }
    if (referralCode.userId === referredUserId) {
      throw new BadRequestException('You cannot use your own referral code');
    }

    const rules = await this.getRewardRules();
    const expiresAt = this.expiryDate(rules.rewardExpiryDays);

    const referral = await this.prisma.$transaction(async (tx) => {
      const created = await tx.referral.create({
        data: {
          referralCodeId: referralCode.id,
          referrerId: referralCode.userId,
          referredUserId,
          status: ReferralStatus.SIGNED_UP,
        },
      });

      await tx.referralCode.update({
        where: { id: referralCode.id },
        data: { totalSignups: { increment: 1 } },
      });

      // Welcome discount for the new user — ready to apply at first enrollment
      if (rules.refereeDiscountPercent > 0) {
        await tx.referralReward.create({
          data: {
            referralId: created.id,
            beneficiaryId: referredUserId,
            kind: ReferralRewardKind.REFEREE,
            discountType: DiscountType.PERCENTAGE,
            discountValue: rules.refereeDiscountPercent,
            status: ReferralRewardStatus.ISSUED,
            issuedAt: new Date(),
            expiresAt,
          },
        });
      }

      return created;
    });

    this.logger.log(
      `Referral signup tracked: ${referral.id} (code ${code})`,
    );

    return referral;
  }

  // ----------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------

  private expiryDate(days: number): Date {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date;
  }

  private async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomBytes(4).toString('hex').toUpperCase();
      const existing = await this.prisma.referralCode.findUnique({
        where: { code },
      });
      if (!existing) return code;
    }
    throw new ConflictException('Could not generate a unique referral code');
  }
}
