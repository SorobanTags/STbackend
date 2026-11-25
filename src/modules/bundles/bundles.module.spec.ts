import { Test, TestingModule } from '@nestjs/testing';
import { BundlesModule } from './bundles.module';
import { BundlesService } from './bundles.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('BundlesModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [BundlesModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
  });

  it('should compile the module and resolve BundlesService', () => {
    const service = module.get(BundlesService);
    expect(service).toBeDefined();
  });
});
