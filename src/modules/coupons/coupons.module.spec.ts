import { Test, TestingModule } from '@nestjs/testing';
import { CouponsModule } from './coupons.module';
import { CouponsService } from './coupons.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('CouponsModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [CouponsModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
  });

  it('should compile the module and resolve CouponsService', () => {
    const service = module.get(CouponsService);
    expect(service).toBeDefined();
  });
});
