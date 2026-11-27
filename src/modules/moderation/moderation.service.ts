import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseStatus,
  ReportCategory,
  ReportStatus,
  ReportTargetType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateFlagDto } from './dto/create-flag.dto';
import { ResolveFlagDto } from './dto/resolve-flag.dto';

const AUTO_UNPUBLISH_THRESHOLD = 3;

const TERMINAL_REPORT_STATUSES: ReportStatus[] = [
  ReportStatus.RESOLVED,
  ReportStatus.DISMISSED,
];

export interface AutoUnpublishResult {
  attempted: boolean;
  applied: boolean;
}

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createFlag(reporterId: string, dto: CreateFlagDto) {
    if (!Object.values(ReportCategory).includes(dto.category)) {
      throw new BadRequestException('Invalid report category');
    }

    const existing = await this.prisma.abuseReport.findFirst({
      where: {
        reporterId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        status: ReportStatus.PENDING,
      },
    });

    if (existing) {
      throw new ConflictException(
        'You have already reported this content and it is pending review',
      );
    }

    const report = await this.prisma.abuseReport.create({
      data: {
        reporterId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        category: dto.category,
        description: dto.description,
        status: ReportStatus.PENDING,
      },
    });

    const reporters = await this.prisma.abuseReport.findMany({
      where: {
        targetType: dto.targetType,
        targetId: dto.targetId,
        status: { in: [ReportStatus.PENDING, ReportStatus.UNDER_REVIEW] },
      },
      distinct: ['reporterId'],
      select: { reporterId: true },
    });

    const pendingCount = reporters.length;
    let autoActionTaken = false;
    let autoActionFailed = false;

    if (pendingCount >= AUTO_UNPUBLISH_THRESHOLD) {
      const result = await this.autoUnpublishTarget(
        dto.targetType,
        dto.targetId,
      );
      autoActionTaken = result.applied;
      autoActionFailed = result.attempted && !result.applied;
    }

    return { report, pendingCount, autoActionTaken, autoActionFailed };
  }

  async resolveFlag(flagId: string, adminId: string, dto: ResolveFlagDto) {
    const flag = await this.prisma.abuseReport.findUnique({
      where: { id: flagId },
    });

    if (!flag) {
      throw new NotFoundException('Report not found');
    }

    if (
      flag.status !== ReportStatus.PENDING &&
      flag.status !== ReportStatus.UNDER_REVIEW
    ) {
      throw new ConflictException(
        'This report has already been resolved and cannot be updated',
      );
    }

    if (!TERMINAL_REPORT_STATUSES.includes(dto.status)) {
      throw new BadRequestException(
        'Resolution status must be RESOLVED or DISMISSED',
      );
    }

    return this.prisma.abuseReport.update({
      where: { id: flagId },
      data: {
        status: dto.status,
        resolvedById: adminId,
        resolutionNote: dto.resolutionNote,
        resolvedAt: new Date(),
      },
    });
  }

  private async autoUnpublishTarget(
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<AutoUnpublishResult> {
    if (targetType === ReportTargetType.COURSE) {
      const course = await this.prisma.course.findUnique({
        where: { id: targetId },
      });

      if (!course || course.status !== CourseStatus.ACTIVE) {
        return { attempted: false, applied: false };
      }

      try {
        await this.prisma.course.update({
          where: { id: targetId },
          data: { status: CourseStatus.PAUSED },
        });

        return { attempted: true, applied: true };
      } catch (err) {
        this.logger.error(
          `Failed to auto-unpublish course ${targetId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return { attempted: true, applied: false };
      }
    }

    if (targetType === ReportTargetType.COMMENT) {
      const comment = await this.prisma.discussionComment.findUnique({
        where: { id: targetId },
      });

      if (!comment) {
        return { attempted: false, applied: false };
      }

      try {
        await this.prisma.discussionComment.update({
          where: { id: targetId },
          data: { isHidden: true },
        });

        return { attempted: true, applied: true };
      } catch (err) {
        this.logger.error(
          `Failed to auto-hide comment ${targetId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return { attempted: true, applied: false };
      }
    }

    return { attempted: false, applied: false };
  }
}
