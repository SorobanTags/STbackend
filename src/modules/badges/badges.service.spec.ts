import { Test, TestingModule } from '@nestjs/testing';
import { BadgesModule } from './badges.module';
import { BadgesService } from './badges.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Issue #7 — BadgesModule dependency resolution
 *
 * Verifies that BadgesModule can be instantiated via Test.createTestingModule
 * with a mocked PrismaService, proving that BadgesService resolves its
 * PrismaService dependency correctly.  PrismaModule is decorated with @Global()
 * so no explicit import is required in BadgesModule, but this test makes the
 * resolution contract explicit.
 */
describe('BadgesModule / BadgesService — dependency resolution (Issue #7)', () => {
  let service: BadgesService;

  const mockPrisma: Partial<PrismaService> = {
    badge: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    } as any,
    user: {
      findUnique: jest.fn(),
    } as any,
    studentBadge: {
      findMany: jest.fn(),
      createMany: jest.fn(),
    } as any,
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [BadgesModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile();

    service = module.get<BadgesService>(BadgesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
