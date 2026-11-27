import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  ANALYTICS_EVENT_TYPES,
  TrackAnalyticsEventDto,
} from './dto/track-analytics-event.dto';

const MAX_RANGE_DAYS = 90;
const MAX_BATCH_SIZE = 100;
const MAX_PROPERTIES_BYTES = 16_384;

const KNOWN_EVENT_TYPES = new Set([
  'page_view',
  'click',
  'course_enrolled',
  'lesson_completed',
  'search',
  'login',
  'signup',
]);

export interface TrackEventInput {
  eventType: string;
  path?: string;
  properties?: Record<string, unknown>;
}

export interface TrackEventContext {
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface TrackEventsBatchInput {
  events: TrackEventInput[];
}

export interface QueryRawEventsInput {
  eventType?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

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
        eventType: dto.eventType.trim(),
        path: dto.path ?? null,
        properties: (dto.properties ?? {}) as any,
        userId: context.userId ?? null,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
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

    if (dto.events.length > MAX_BATCH_SIZE) {
      throw new BadRequestException(
        `Batch size exceeds maximum of ${MAX_BATCH_SIZE}`,
      );
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
          eventType: event.eventType.trim(),
          path: event.path ?? null,
          properties: (event.properties ?? {}) as any,
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
    const where: any = {
      occurredAt: this.boundedRange(from, to),
    };

    const grouped = await this.prisma.analyticsEvent.groupBy({
      by: ['eventType'],
      where: {
        createdAt: {
          gte: new Date(from),
          lte: new Date(to),
        },
      },
      _count: { _all: true },
    });

    const byEventType = rows.map((row: any) => ({
      eventType: row.eventType,
      count: row._count?._all ?? 0,
    }));
    const total = byEventType.reduce((sum, row) => sum + row.count, 0);

    return { total, byEventType };
  }

  async queryRawEvents(input: QueryRawEventsInput) {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));

    const where: any = {
      occurredAt: this.boundedRange(input.from, input.to),
    };
    if (input.eventType) {
      where.eventType = input.eventType;
    }
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
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
}
