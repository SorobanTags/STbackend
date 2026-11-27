import { Test } from '@nestjs/testing';
import { AnalyticsModule } from './analytics.module';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('AnalyticsModule', () => {
  it('compiles and resolves AnalyticsService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AnalyticsModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(moduleRef.get(AnalyticsService)).toBeDefined();
  });
});
