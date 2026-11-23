import { Test } from '@nestjs/testing';
import { ScheduleModule } from '@nestjs/schedule';
import { LessonsModule } from './lessons.module';
import { DripScheduleService } from './drip-schedule.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';

// Minimal mock for NotificationsModule
const NotificationsModuleMock = {
  module: class {},
  providers: [
    {
      provide: 'NotificationsService',
      useValue: {},
    },
  ],
  exports: ['NotificationsService'],
};

describe('LessonsModule (Issue #33)', () => {
  it('compiles without ScheduleModule.forRoot() in its own imports', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        // Provide ScheduleModule.forRoot() at the root level (simulating AppModule)
        ScheduleModule.forRoot(),
        LessonsModule,
      ],
    })
      .overrideModule(NotificationsModule)
      .useModule({ module: class MockNotificationsModule {} })
      .overrideModule(EnrollmentsModule)
      .useModule({ module: class MockEnrollmentsModule {} })
      .compile();

    expect(moduleRef).toBeDefined();
  });

  it('resolves DripScheduleService from the testing module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ScheduleModule.forRoot(),
        LessonsModule,
      ],
    })
      .overrideModule(NotificationsModule)
      .useModule({ module: class MockNotificationsModule {} })
      .overrideModule(EnrollmentsModule)
      .useModule({ module: class MockEnrollmentsModule {} })
      .compile();

    const service = moduleRef.get(DripScheduleService, { strict: false });
    expect(service).toBeDefined();
  });
});
