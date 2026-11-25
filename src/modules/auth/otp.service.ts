import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';

export class TooManyRequestsException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TooManyRequestsException';
  }
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly otpExpiryMinutes = 10;
  private readonly maxAttempts = 5;
  private readonly rateLimitWindowMs = 60 * 60 * 1000; // 1 hour
  private readonly maxRequestsPerWindow = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Generate a cryptographically secure 6-digit OTP.
   * Uses crypto.randomInt for uniform distribution over [100000, 999999].
   */
  private generateOtp(): string {
    return randomInt(100000, 1000000).toString();
  }

  async sendOtp(
    userId: string,
    phoneNumber: string,
    countryCode: string,
  ): Promise<void> {
    // Rate limiting: count recent OTPs for this user/phone
    const windowStart = new Date(Date.now() - this.rateLimitWindowMs);
    const recentCount = await this.prisma.phoneOtp.count({
      where: {
        userId,
        phoneNumber,
        createdAt: { gte: windowStart },
      },
    });

    if (recentCount >= this.maxRequestsPerWindow) {
      throw new TooManyRequestsException(
        'Too many OTP requests. Please try again later.',
      );
    }

    // Invalidate any existing unused OTPs for this phone
    await this.prisma.phoneOtp.updateMany({
      where: {
        userId,
        phoneNumber,
        isUsed: false,
      },
      data: {
        isUsed: true,
      },
    });

    const otp = this.generateOtp();
    const expiresAt = new Date(
      Date.now() + this.otpExpiryMinutes * 60 * 1000,
    );

    await this.prisma.phoneOtp.create({
      data: {
        userId,
        phoneNumber,
        countryCode,
        otp,
        expiresAt,
      },
    });

    // In production, dispatch via SMS provider here.
    this.logger.log(`OTP generated for ${phoneNumber}`);
  }

  async verifyOtp(
    userId: string,
    phoneNumber: string,
    otp: string,
  ): Promise<boolean> {
    const record = await this.prisma.phoneOtp.findFirst({
      where: {
        userId,
        phoneNumber,
        isUsed: false,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new UnauthorizedException('No active OTP found');
    }

    if (record.attemptCount >= this.maxAttempts) {
      throw new UnauthorizedException('Maximum attempts exceeded');
    }

    if (record.expiresAt < new Date()) {
      await this.prisma.phoneOtp.update({
        where: { id: record.id },
        data: { isUsed: true },
      });
      throw new UnauthorizedException('OTP has expired');
    }

    if (record.otp !== otp) {
      await this.prisma.phoneOtp.update({
        where: { id: record.id },
        data: { attemptCount: record.attemptCount + 1 },
      });
      throw new UnauthorizedException('Invalid OTP');
    }

    await this.prisma.phoneOtp.update({
      where: { id: record.id },
      data: {
        isUsed: true,
        verifiedAt: new Date(),
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        phoneNumber,
        phoneCountryCode: record.countryCode,
        isPhoneVerified: true,
        phoneVerifiedAt: new Date(),
      },
    });

    return true;
  }

  async getVerificationStatus(userId: string): Promise<{
    isPhoneVerified: boolean;
    phoneNumber: string | null;
    phoneVerifiedAt: Date | null;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isPhoneVerified: true,
        phoneNumber: true,
        phoneVerifiedAt: true,
      },
    });

    return {
      isPhoneVerified: user?.isPhoneVerified ?? false,
      phoneNumber: user?.phoneNumber ?? null,
      phoneVerifiedAt: user?.phoneVerifiedAt ?? null,
    };
  }
}
