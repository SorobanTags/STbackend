import { Test } from '@nestjs/testing';
import { PrivacyModule } from './privacy.module';
import { DataExportService } from './data-export.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('PrivacyModule', () => {
  it('compiles and resolves DataExportService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrivacyModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(moduleRef.get(DataExportService)).toBeDefined();
  });
});
