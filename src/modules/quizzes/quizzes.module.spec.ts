import { Test, TestingModule } from '@nestjs/testing';
import { QuizzesModule } from './quizzes.module';
import { QuizzesService } from './quizzes.service';
import { QuizAttemptsService } from './quiz-attempts.service';
import { QuizSessionsService } from './quiz-sessions.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const mockPrisma = {
  quiz: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
  quizAttempt: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  quizSession: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
};

describe('QuizzesModule', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [QuizzesModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should resolve QuizzesService', () => {
    const service = module.get<QuizzesService>(QuizzesService);
    expect(service).toBeDefined();
  });

  it('should resolve QuizAttemptsService', () => {
    const service = module.get<QuizAttemptsService>(QuizAttemptsService);
    expect(service).toBeDefined();
  });

  it('should resolve QuizSessionsService', () => {
    const service = module.get<QuizSessionsService>(QuizSessionsService);
    expect(service).toBeDefined();
  });
});
