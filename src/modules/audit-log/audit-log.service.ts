import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditAction, AuditTargetType } from '@prisma/client';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

export interface AuditLogCsvRow {
  actorId: string | null;
  actor: { name: string | null; email: string | null } | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: Date;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);
  private readonly retentionDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.retentionDays = this.configService.get<number>('AUDIT_LOG_RETENTION_DAYS', 90);
  }

  async createEntry(actorId: string, dto: CreateAuditLogDto) {
    return this.prisma.adminAuditLog.create({
      data: {
        actorId,
        action: dto.action,
        targetType: dto.targetType,
        targetId: dto.targetId,
        metadata: dto.metadata ?? null,
        ipAddress: dto.ipAddress,
      },
    });
  }

  async findAll(query: QueryAuditLogDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = this.buildWhere(query);

    const [data, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { name: true, email: true } } },
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async exportAuditLogCsv(query: QueryAuditLogDto): Promise<string> {
    const where = this.buildWhere(query);
    const batchSize = 500;
    let skip = 0;
    let hasMore = true;

    const lines: string[] = [];
    let headerWritten = false;

    while (hasMore) {
      const batch = (await this.prisma.adminAuditLog.findMany({
        where,
        skip,
        take: batchSize,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { name: true, email: true } } },
      })) as AuditLogCsvRow[];

      if (!headerWritten) {
        lines.push(this.csvHeader());
        headerWritten = true;
      }

      for (const row of batch) {
        lines.push(this.csvLine(row));
      }

      hasMore = batch.length === batchSize;
      skip += batchSize;
    }

    if (!headerWritten) {
      lines.push(this.csvHeader());
    }

    return lines.join('\n');
  }

  private csvHeader(): string {
    return [
      'createdAt',
      'actorId',
      'actorName',
      'actorEmail',
      'action',
      'targetType',
      'targetId',
      'ipAddress',
      'metadata',
    ].join(',');
  }

  private csvLine(row: AuditLogCsvRow): string {
    return [
      row.createdAt.toISOString(),
      row.actorId ?? '',
      row.actor?.name ?? '',
      row.actor?.email ?? '',
      row.action,
      row.targetType,
      row.targetId ?? '',
      row.ipAddress ?? '',
      row.metadata ? JSON.stringify(row.metadata) : '',
    ]
      .map((value) => this.escape(String(value)))
      .join(',');
  }

  private escape(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  async purgeOldEntries() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.retentionDays);

    const result = await this.prisma.adminAuditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    this.logger.log(`Purged ${result.count} audit log entries older than ${this.retentionDays} days`);
    return result;
  }

  private buildWhere(query: QueryAuditLogDto) {
    const where: Record<string, unknown> = {};

    if (query.actorId) where.actorId = query.actorId;
    if (query.action) where.action = query.action;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;
    if (query.startDate || query.endDate) {
      where.createdAt = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      };
    }

    return where;
  }
}
