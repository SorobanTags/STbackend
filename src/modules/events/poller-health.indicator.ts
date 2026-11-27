import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CheckpointStatus, EVENT_POLLER_CHECKPOINT_KEY } from './events.service';

/**
 * PollerHealthIndicator
 *
 * Narrow provider that exposes only the event-poller checkpoint status for
 * the health endpoint.  It reads directly from the database so it can be
 * provided to HealthModule without importing the full EventsModule (which
 * pulls in NotificationsModule, EnrollmentsModule and CoursesModule).
 *
 * PrismaModule is @Global(), so PrismaService is available to any module
 * without an explicit import.
 */
@Injectable()
export class PollerHealthIndicator {
  private readonly logger = new Logger(PollerHealthIndicator.name);

  constructor(private readonly prisma: PrismaService) {}

  async getCheckpointStatus(): Promise<CheckpointStatus> {
    let row: { lastProcessedLedger: number; lastPolledAt: Date | null; consecutiveWriteFailures: number; lastWriteError: string | null } | null = null;

    try {
      row = await this.prisma.eventPollerCheckpoint.findUnique({
        where: { key: EVENT_POLLER_CHECKPOINT_KEY },
      });
    } catch (error) {
      this.logger.error('Could not read checkpoint for health report', (error as Error).message);
    }

    return {
      key: EVENT_POLLER_CHECKPOINT_KEY,
      lastProcessedLedger: row?.lastProcessedLedger ?? 0,
      persistedLedger: row?.lastProcessedLedger ?? null,
      lastPolledAt: row?.lastPolledAt ?? null,
      resumedFromCheckpoint: false,
      consecutiveWriteFailures: row?.consecutiveWriteFailures ?? 0,
      lastWriteError: row?.lastWriteError ?? null,
      healthy: (row?.consecutiveWriteFailures ?? 0) === 0,
    };
  }
}
