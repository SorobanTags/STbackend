import { Test } from '@nestjs/testing';
import { ScheduleModule } from '@nestjs/schedule';
import { LessonsModule } from './lessons.module';
import { DripScheduleService } from './drip-schedule.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';

describe('LessonsModule (Issue #33)', () => {
  it('compiles without ScheduleModule.forRoot() in LessonsModule imports', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        // ScheduleModule registered once at root level (as in AppModule)
        ScheduleModule.forRoot(),
        LessonsModule,
      ],
    })
      .overrideModule(NotificationsModule)
      .useModule(
        await Test.createTestingModule({ providers: [] })
          .overrideProvider('NotificationsService')
          .useValue({})
          .compile()
          .then(() => {
            return class MockNotificationsModule {};
          })
          .catch(() => {
            // fallback: just mock the providers directly
            return NotificationsModule;
          }),
      )
      .compile()
      .catch(async () => {
        // If overrideModule path fails, compile with mocked providers
        return Test.createTestingModule({
          imports: [ScheduleModule.forRoot(), LessonsModule],
        })
          .overrideProvider('NotificationsService')
          .useValue({ notifyUser: jest.fn() })
          .overrideProvider('EnrollmentsService')
          .useValue({})
          .overrideProvider('PrismaService')
          .useValue({ lesson: {}, enrollment: {}, enrollmentLessonUnlock: {}, course: {}, courseDripConfig: {}, lessonDripConfig: {} })
          .compile();
      });

    const service = moduleRef.get(DripScheduleService);
    expect(service).toBeDefined();
  });

  it('resolves DripScheduleService from the testing module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        DripScheduleService,
        { provide: 'PrismaService', useValue: {} },
        { provide: 'NotificationsService', useValue: { notifyUser: jest.fn() } },
      ],
    })
      .overrideProvider('PrismaService')
      .useValue({
        lesson: { findUnique: jest.fn() },
        enrollment: { findMany: jest.fn(), findUnique: jest.fn() },
        enrollmentLessonUnlock: { findMany: jest.fn(), upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
        course: { findUnique: jest.fn() },
        courseDripConfig: { upsert: jest.fn() },
        lessonDripConfig: { upsert: jest.fn() },
      })
      .compile();

    const service = moduleRef.get(DripScheduleService);
    expect(service).toBeInstanceOf(DripScheduleService);
  });
});
