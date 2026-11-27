// events.module.ts
import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { PollerHealthIndicator } from './poller-health.indicator';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule, EnrollmentsModule, CoursesModule],
  providers: [EventsService, PollerHealthIndicator],
  controllers: [EventsController],
  exports: [EventsService, PollerHealthIndicator],
})
export class EventsModule {}
