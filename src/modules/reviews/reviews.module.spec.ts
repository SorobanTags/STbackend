import { Test, TestingModule } from '@nestjs/testing';
import { ReviewsModule } from './reviews.module';
import { ReviewsService } from './reviews.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';

describe('ReviewsModule', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ReviewsModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        course: { findUnique: jest.fn(), update: jest.fn() },
        courseReview: {
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
          findMany: jest.fn(),
          count: jest.fn(),
          aggregate: jest.fn(),
        },
        $transaction: jest.fn(),
      })
      .overrideProvider(EnrollmentsService)
      .useValue({ isEnrolled: jest.fn() })
      .compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('compiles ReviewsModule successfully', () => {
    expect(module).toBeDefined();
  });

  it('resolves ReviewsService from the module', () => {
    const service = module.get<ReviewsService>(ReviewsService);
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(ReviewsService);
  });
});
