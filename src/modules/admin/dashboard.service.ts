// dashboard.service.ts — issue #61: admin dashboard summary stats API
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { CourseStatus, EnrollmentStatus, UserRole } from '@prisma/client';

const STALE_AFTER_MS = 30 * 60 * 1000; // matches the scheduled recalculation cadence
const SUMMARY_CACHE_KEY = 'admin:dashboard:summary';
const SUMMARY_CACHE_TTL_SECONDS = 35 * 60; // slightly longer than the cron cadence

interface SummaryStats {
  users: { total: number; students: number; instructors: number; newInPeriod: number };
  courses: { total: number; active: number; pending: number; archived: number };
  enrollments: { totalInPeriod: number; completedInPeriod: number; allTime: number };
  revenue: { totalInPeriod: number; currency: string };
}

interface CachedSnapshot {
  data: SummaryStats;
  calculatedAt: string; // ISO string — survives JSON round-trip
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getSummary(query: DashboardQueryDto) {
    const { startDate, endDate } = query;
    this.validateDateRange(startDate, endDate);

    // No period given — serve the periodically recalculated all-time cache.
    if (!startDate && !endDate) {
      const snapshot = await this.cache.get<CachedSnapshot>(SUMMARY_CACHE_KEY);
      if (snapshot) {
        const calculatedAt = new Date(snapshot.calculatedAt);
        return {
          ...snapshot.data,
          meta: {
            calculatedAt,
            isStale: Date.now() - calculatedAt.getTime() > STALE_AFTER_MS,
            source: 'cache' as const,
          },
        };
      }
      // No snapshot yet — compute live and cache it.
      const { data, calculatedAt } = await this.recalculate();
      return {
        ...data,
        meta: {
          calculatedAt,
          isStale: false,
          source: 'cache' as const,
        },
      };
    }

    // A specific period was requested — compute it live (not cached, since ranges vary per request).
    const data = await this.computeSummary(startDate, endDate);
    return {
      ...data,
      meta: { calculatedAt: new Date(), isStale: false, source: 'live' as const },
    };
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleScheduledRecalculation() {
    this.logger.log('Recalculating admin dashboard summary stats...');
    await this.recalculate();
    this.logger.log('Admin dashboard summary stats recalculated.');
  }

  private async recalculate() {
    const data = await this.computeSummary();
    const calculatedAt = new Date();
    const snapshot: CachedSnapshot = { data, calculatedAt: calculatedAt.toISOString() };
    await this.cache.set(SUMMARY_CACHE_KEY, snapshot, SUMMARY_CACHE_TTL_SECONDS);
    return { data, calculatedAt };
  }

  private validateDateRange(startDate?: string, endDate?: string): void {
    if (!startDate && !endDate) return;
    if (!startDate || !endDate) {
      throw new BadRequestException('Both startDate and endDate must be provided together');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('startDate and endDate must be valid ISO date strings');
    }
    if (start > end) {
      throw new BadRequestException('startDate must be before or equal to endDate');
    }
    if (end.getTime() > Date.now()) {
      throw new BadRequestException('endDate cannot be in the future');
    }
  }

  private async computeSummary(startDate?: string, endDate?: string): Promise<SummaryStats> {
    const period = startDate && endDate
      ? { gte: new Date(startDate), lte: new Date(endDate) }
      : undefined;

    const [
      totalUsers,
      students,
      instructors,
      newInPeriod,
      totalCourses,
      activeCourses,
      pendingCourses,
      archivedCourses,
      enrollmentsAllTime,
      enrollmentsInPeriod,
      completedInPeriod,
      revenueAgg,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: UserRole.STUDENT } }),
      this.prisma.user.count({ where: { role: UserRole.INSTRUCTOR } }),
      this.prisma.user.count({ where: period ? { createdAt: period } : undefined }),
      this.prisma.course.count(),
      this.prisma.course.count({ where: { status: CourseStatus.ACTIVE } }),
      this.prisma.course.count({ where: { status: CourseStatus.PENDING } }),
      this.prisma.course.count({ where: { status: CourseStatus.ARCHIVED } }),
      this.prisma.enrollment.count(),
      this.prisma.enrollment.count({ where: period ? { enrolledAt: period } : undefined }),
      this.prisma.enrollment.count({
        where: {
          status: EnrollmentStatus.COMPLETED,
          ...(period ? { enrolledAt: period } : {}),
        },
      }),
      this.prisma.enrollment.aggregate({
        where: period ? { enrolledAt: period } : undefined,
        _sum: { amountPaid: true },
      }),
    ]);

    return {
      users: { total: totalUsers, students, instructors, newInPeriod },
      courses: {
        total: totalCourses,
        active: activeCourses,
        pending: pendingCourses,
        archived: archivedCourses,
      },
      enrollments: {
        totalInPeriod: enrollmentsInPeriod,
        completedInPeriod,
        allTime: enrollmentsAllTime,
      },
      revenue: {
        totalInPeriod: this.normalizeAmount(revenueAgg._sum.amountPaid),
        currency: 'USDC',
      },
    };
  }

  private normalizeAmount(value: unknown): number {
    const num = Number(value ?? 0);
    return Math.round(num * 100) / 100;
  }
}
