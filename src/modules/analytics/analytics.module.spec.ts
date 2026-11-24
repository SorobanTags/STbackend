import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AnalyticsModule } from './analytics.module';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsModule', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AnalyticsModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should compile and resolve AnalyticsService', () => {
    const service = module.get<AnalyticsService>(AnalyticsService);
    expect(service).toBeDefined();
  });
});
