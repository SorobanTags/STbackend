import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

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

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async trackEvent(input: TrackEventInput, context: TrackEventContext = {}) {
    this.validateEventPayload(input);

    return this.prisma.analyticsEvent.create({
      data: {
        eventType: input.eventType.trim(),
        path: input.path ?? null,
        properties: (input.properties ?? {}) as any,
        userId: context.userId ?? null,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      },
    });
  }

  async trackEventsBatch(input: TrackEventsBatchInput) {
    if (!input || !Array.isArray(input.events) || input.events.length === 0) {
      throw new BadRequestException('events must be a non-empty array');
    }
    if (input.events.length > MAX_BATCH_SIZE) {
      throw new BadRequestException(
        `Batch size exceeds maximum of ${MAX_BATCH_SIZE}`,
      );
    }

    for (const event of input.events) {
      this.validateEventPayload(event);
    }

    const result = await this.prisma.analyticsEvent.createMany({
      data: input.events.map((event) => ({
        eventType: event.eventType.trim(),
        path: event.path ?? null,
        properties: (event.properties ?? {}) as any,
      })),
    });

    return { ingested: result.count, requested: input.events.length };
  }

  async getVolumeByEventType(from?: string, to?: string) {
    const where: any = {
      occurredAt: this.boundedRange(from, to),
    };

    const grouped = await this.prisma.analyticsEvent.groupBy({
      by: ['eventType'],
      where,
      _count: { _all: true },
    });

    const byEventType = grouped.map((row: any) => ({
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

    const [data, total] = await Promise.all([
      this.prisma.analyticsEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
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

  validateEventPayload(input: TrackEventInput) {
    if (!input || typeof input.eventType !== 'string' || !input.eventType.trim()) {
      throw new BadRequestException('eventType is required');
    }

    const eventType = input.eventType.trim();
    if (!KNOWN_EVENT_TYPES.has(eventType) && !eventType.startsWith('custom.')) {
      this.logger.debug(`Unknown event type: ${eventType}`);
    }

    if (input.properties !== undefined) {
      if (
        input.properties === null ||
        typeof input.properties !== 'object' ||
        Array.isArray(input.properties)
      ) {
        throw new BadRequestException('properties must be an object');
      }

      const size = Buffer.byteLength(JSON.stringify(input.properties), 'utf8');
      if (size > MAX_PROPERTIES_BYTES) {
        throw new BadRequestException('properties payload too large');
      }
    }
  }

  private boundedRange(from?: string, to?: string): { gte: Date; lte: Date } {
    if (!from || !to) {
      throw new BadRequestException('from and to are required');
    }

    const gte = new Date(from);
    const lte = new Date(to);

    if (Number.isNaN(gte.getTime()) || Number.isNaN(lte.getTime())) {
      throw new BadRequestException('from and to must be valid dates');
    }
    if (gte > lte) {
      throw new BadRequestException('from must be before to');
    }

    const spanDays = (lte.getTime() - gte.getTime()) / (1000 * 60 * 60 * 24);
    if (spanDays > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Date range exceeds maximum of ${MAX_RANGE_DAYS} days`,
      );
    }

    return { gte, lte };
  }
}
