import { Module, forwardRef } from '@nestjs/common';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';
import { DripScheduleService } from './drip-schedule.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';

@Module({
  imports: [
    NotificationsModule,
    forwardRef(() => EnrollmentsModule),
  ],
  controllers: [LessonsController],
  providers: [LessonsService, DripScheduleService],
  exports: [LessonsService, DripScheduleService],
})
export class LessonsModule {}
