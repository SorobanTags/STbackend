import { Test, TestingModule } from '@nestjs/testing';
import { ScheduleModule } from '@nestjs/schedule';
import { LessonsModule } from './lessons.module';
import { LessonsService } from './lessons.service';
import { DripScheduleService } from './drip-schedule.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const mockPrisma = {
  lesson: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
  enrollment: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
  lessonProgress: { findUnique: jest.fn(), upsert: jest.fn() },
  dripSchedule: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  enrollmentLessonUnlock: { findMany: jest.fn(), upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  course: { findUnique: jest.fn() },
  courseDripConfig: { upsert: jest.fn() },
  lessonDripConfig: { upsert: jest.fn() },
  $transaction: jest.fn(),
};

const mockNotificationsService = {
  sendNotification: jest.fn(),
  createNotification: jest.fn(),
  notifyUser: jest.fn(),
};

const mockEnrollmentsService = {
  findById: jest.fn(),
  getEnrollment: jest.fn(),
};

describe('LessonsModule', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot(), LessonsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(NotificationsService)
      .useValue(mockNotificationsService)
      .overrideProvider(EnrollmentsService)
      .useValue(mockEnrollmentsService)
      .compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should resolve LessonsService', () => {
    const service = module.get<LessonsService>(LessonsService);
    expect(service).toBeDefined();
  });

  it('should resolve DripScheduleService', () => {
    const service = module.get<DripScheduleService>(DripScheduleService);
    expect(service).toBeDefined();
  });
});
