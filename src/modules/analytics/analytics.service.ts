import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  ANALYTICS_EVENT_TYPES,
  TrackAnalyticsEventDto,
} from './dto/track-analytics-event.dto';

const MAX_PROPERTIES_BYTES = 16_384;

export interface TrackEventContext {
  userId?: string;
  ipAddress?: string;
}

export interface RejectedEvent {
  index: number;
  reason: string;
}

export interface TrackEventsBatchResult {
  ingested: number;
  requested: number;
  rejected: RejectedEvent[];
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async trackEvent(dto: TrackAnalyticsEventDto, context: TrackEventContext = {}) {
    this.validateEventPayload(dto);

    return this.prisma.analyticsEvent.create({
      data: {
        eventType: dto.eventType,
        path: dto.path ?? null,
        properties: dto.properties ?? undefined,
        userId: context.userId ?? null,
        ipAddress: context.ipAddress ?? null,
      },
    });
  }

  /**
   * Batch-ingests analytics events.
   *
   * Invalid events are skipped rather than rejecting the whole batch. The
   * returned object reports `ingested` (rows actually written), `requested`
   * (events submitted) and `rejected` (index + reason for each skipped event).
   * A `createMany` count lower than the number of valid events is surfaced via
   * `ingested` so callers can detect partial writes.
   */
  async trackEventsBatch(dto: {
    events: TrackAnalyticsEventDto[];
  }): Promise<TrackEventsBatchResult> {
    if (!dto.events || dto.events.length === 0) {
      throw new BadRequestException('events array must not be empty');
    }

    const valid: TrackAnalyticsEventDto[] = [];
    const rejected: RejectedEvent[] = [];

    dto.events.forEach((event, index) => {
      try {
        this.validateEventPayload(event);
        valid.push(event);
      } catch (error) {
        rejected.push({
          index,
          reason:
            error instanceof BadRequestException
              ? error.message
              : 'invalid event payload',
        });
      }
    });

    let ingested = 0;
    if (valid.length > 0) {
      const result = await this.prisma.analyticsEvent.createMany({
        data: valid.map((event) => ({
          eventType: event.eventType,
          path: event.path ?? null,
          properties: event.properties ?? undefined,
        })),
      });
      ingested = result.count;

      if (ingested < valid.length) {
        this.logger.warn(
          `Analytics batch partial write: ingested ${ingested} of ${valid.length} valid events`,
        );
      }
    }

    return {
      ingested,
      requested: dto.events.length,
      rejected,
    };
  }

  validateEventPayload(dto: TrackAnalyticsEventDto): void {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('event payload must be an object');
    }

    if (!dto.eventType || typeof dto.eventType !== 'string' || !dto.eventType.trim()) {
      throw new BadRequestException('eventType is required');
    }

    const isKnown = ANALYTICS_EVENT_TYPES.includes(dto.eventType);
    const isCustom = /^[a-z0-9_]+\.[a-z0-9_]+$/i.test(dto.eventType);
    if (!isKnown && !isCustom) {
      throw new BadRequestException(`unknown eventType: ${dto.eventType}`);
    }

    if (dto.properties !== undefined) {
      if (
        dto.properties === null ||
        typeof dto.properties !== 'object' ||
        Array.isArray(dto.properties)
      ) {
        throw new BadRequestException('properties must be a plain object');
      }

      const size = Buffer.byteLength(JSON.stringify(dto.properties), 'utf8');
      if (size > MAX_PROPERTIES_BYTES) {
        throw new BadRequestException('properties payload too large');
      }
    }
  }

  async getVolumeByEventType(from: string, to: string) {
    const rows = await this.prisma.analyticsEvent.groupBy({
      by: ['eventType'],
      where: {
        createdAt: {
          gte: new Date(from),
          lte: new Date(to),
        },
      },
      _count: { _all: true },
    });

    const byEventType = rows.map((row) => ({
      eventType: row.eventType,
      count: row._count._all,
    }));

    return {
      total: byEventType.reduce((sum, row) => sum + row.count, 0),
      byEventType,
    };
  }

  async queryRawEvents(query: {
    eventType?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 10;

    const where: Record<string, unknown> = {};
    if (query.eventType) {
      where.eventType = query.eventType;
    }
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.analyticsEvent.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.analyticsEvent.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
