// health.module.ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PollerHealthIndicator } from '../events/poller-health.indicator';
import { SearchModule } from '../search/search.module';

/**
 * HealthModule
 *
 * Intentionally does NOT import EventsModule, which would drag in
 * NotificationsModule, EnrollmentsModule and CoursesModule.  Instead it
 * provides only the narrow PollerHealthIndicator (backed by the global
 * PrismaService) so a provider-graph failure in any of those heavy modules
 * cannot take down the liveness endpoint.
 */
@Module({
  imports: [TerminusModule, SearchModule],
  controllers: [HealthController],
  providers: [PollerHealthIndicator],
})
export class HealthModule {}
