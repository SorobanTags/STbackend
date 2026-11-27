// reports.module.ts
import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { EngagementReportController } from './engagement-report.controller';
import { EngagementReportService } from './engagement-report.service';
import { InstructorReportController } from './instructor-report.controller';
import { InstructorReportService } from './instructor-report.service';
import { RevenueReportController } from './revenue-report.controller';
import { RevenueReportService } from './revenue-report.service';
import { TopCoursesController } from './top-courses.controller';
import { TopCoursesService } from './top-courses.service';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [
    ReportsController,
    EngagementReportController,
    InstructorReportController,
    RevenueReportController,
    TopCoursesController,
  ],
  providers: [
    ReportsService,
    EngagementReportService,
    InstructorReportService,
    RevenueReportService,
    TopCoursesService,
  ],
  exports: [
    ReportsService,
    EngagementReportService,
    InstructorReportService,
    RevenueReportService,
    TopCoursesService,
  ],
})
export class ReportsModule {}
