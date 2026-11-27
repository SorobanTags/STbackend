import { Test, TestingModule } from '@nestjs/testing';
import { ReportsModule } from './reports.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReportsService } from './reports.service';
import { EngagementReportService } from './engagement-report.service';
import { InstructorReportService } from './instructor-report.service';
import { RevenueReportService } from './revenue-report.service';
import { TopCoursesService } from './top-courses.service';

const mockPrismaService = {
  $connect: jest.fn(),
  $disconnect: jest.fn(),
  user: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
  course: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
  enrollment: { findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
  review: { findMany: jest.fn(), aggregate: jest.fn(), groupBy: jest.fn() },
  payout: { findMany: jest.fn(), aggregate: jest.fn() },
  transaction: { findMany: jest.fn(), groupBy: jest.fn() },
};

describe('ReportsModule', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ReportsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .compile();
  });

  it('compiles the module without errors', () => {
    expect(module).toBeDefined();
  });

  it('resolves ReportsService', () => {
    expect(module.get(ReportsService)).toBeInstanceOf(ReportsService);
  });

  it('resolves EngagementReportService', () => {
    expect(module.get(EngagementReportService)).toBeInstanceOf(EngagementReportService);
  });

  it('resolves InstructorReportService', () => {
    expect(module.get(InstructorReportService)).toBeInstanceOf(InstructorReportService);
  });

  it('resolves RevenueReportService', () => {
    expect(module.get(RevenueReportService)).toBeInstanceOf(RevenueReportService);
  });

  it('resolves TopCoursesService', () => {
    expect(module.get(TopCoursesService)).toBeInstanceOf(TopCoursesService);
  });
});
