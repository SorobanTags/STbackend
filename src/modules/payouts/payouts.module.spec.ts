import { Test, TestingModule } from '@nestjs/testing';
import { PayoutsModule } from './payouts.module';
import { PayoutsService } from './payouts.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { KycService } from '../kyc/kyc.service';

const mockPrisma = {
  user: { findUnique: jest.fn() },
  payout: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockKycService = {
  getVerificationStatus: jest.fn(),
};

describe('PayoutsModule', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PayoutsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(KycService)
      .useValue(mockKycService)
      .compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should resolve PayoutsService', () => {
    const service = module.get<PayoutsService>(PayoutsService);
    expect(service).toBeDefined();
  });
});
