import { Test, TestingModule } from '@nestjs/testing';
import { QuizzesService } from './quizzes.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UserRole, QuestionType } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

describe('QuizzesService (Issue #168) — hide correctAnswer from students', () => {
  let service: QuizzesService;

  const mockQuestion = {
    id: 'q1',
    lessonId: 'l1',
    question: 'What is 2+2?',
    type: 'SINGLE_CHOICE',
    options: ['3', '4', '5'],
    correctAnswer: [1],
    explanation: 'Basic arithmetic',
    points: 1,
    position: 1,
  };

  const mockPrisma = {
    lesson: { findUnique: jest.fn().mockResolvedValue({ id: 'l1' }) },
    quizQuestion: {
      findUnique: jest.fn().mockResolvedValue(mockQuestion),
      findMany: jest.fn().mockResolvedValue([mockQuestion]),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizzesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<QuizzesService>(QuizzesService);
  });

  it('should hide correctAnswer and explanation for STUDENT on getQuestionById', async () => {
    const result = await service.getQuestionById('q1', UserRole.STUDENT);
    expect(result).not.toHaveProperty('correctAnswer');
    expect(result).not.toHaveProperty('explanation');
    expect(result).toHaveProperty('question');
  });

  it('should include correctAnswer and explanation for INSTRUCTOR on getQuestionById', async () => {
    const result = await service.getQuestionById('q1', UserRole.INSTRUCTOR);
    expect(result).toHaveProperty('correctAnswer');
    expect(result).toHaveProperty('explanation');
  });

  it('should hide correctAnswer and explanation for STUDENT on getQuestionsByLesson', async () => {
    const results = await service.getQuestionsByLesson('l1', UserRole.STUDENT);
    expect(results.length).toBeGreaterThan(0);
    for (const q of results) {
      expect(q).not.toHaveProperty('correctAnswer');
      expect(q).not.toHaveProperty('explanation');
    }
  });

  it('should include correctAnswer for INSTRUCTOR on getQuestionsByLesson', async () => {
    const results = await service.getQuestionsByLesson('l1', UserRole.INSTRUCTOR);
    expect(results[0]).toHaveProperty('correctAnswer');
  });
});

// ---------------------------------------------------------------------------
// Issue #57 — validateQuestionData branch coverage
// ---------------------------------------------------------------------------
describe('QuizzesService — validateQuestionData branches (Issue #57)', () => {
  let service: QuizzesService;

  const lesson = {
    id: 'l1',
    module: { course: { instructorAddress: 'user1', instructor: { id: 'user1' } } },
  };

  const mockPrisma = {
    lesson: { findUnique: jest.fn().mockResolvedValue(lesson) },
    quizQuestion: { create: jest.fn().mockResolvedValue({ id: 'q-new' }) },
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        QuizzesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<QuizzesService>(QuizzesService);
    jest.clearAllMocks();
    mockPrisma.lesson.findUnique.mockResolvedValue(lesson);
    mockPrisma.quizQuestion.create.mockResolvedValue({ id: 'q-new' });
  });

  async function createQ(overrides: any) {
    return service.createQuestion(
      'l1',
      {
        question: 'Q?',
        type: QuestionType.SINGLE_CHOICE,
        options: ['A', 'B'],
        correctAnswer: [0],
        points: 1,
        ...overrides,
      } as any,
      'user1',
      'INSTRUCTOR',
    );
  }

  it('throws when correctAnswer is missing', async () => {
    await expect(createQ({ correctAnswer: undefined })).rejects.toThrow(BadRequestException);
  });

  it('throws when correctAnswer is empty array', async () => {
    await expect(createQ({ correctAnswer: [] })).rejects.toThrow(BadRequestException);
  });

  it('throws for SINGLE_CHOICE with fewer than 2 options', async () => {
    await expect(
      createQ({ type: QuestionType.SINGLE_CHOICE, options: ['OnlyOne'], correctAnswer: [0] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws for SINGLE_CHOICE with more than 1 correct answer', async () => {
    await expect(
      createQ({ type: QuestionType.SINGLE_CHOICE, options: ['A', 'B', 'C'], correctAnswer: [0, 1] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws for SINGLE_CHOICE with out-of-bounds index', async () => {
    await expect(
      createQ({ type: QuestionType.SINGLE_CHOICE, options: ['A', 'B'], correctAnswer: [5] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws for MULTIPLE_CHOICE with fewer than 2 options', async () => {
    await expect(
      createQ({ type: QuestionType.MULTIPLE_CHOICE, options: ['Solo'], correctAnswer: [0] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws for TRUE_FALSE with more than 1 answer', async () => {
    await expect(
      createQ({ type: QuestionType.TRUE_FALSE, options: undefined, correctAnswer: ['true', 'false'] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws for TRUE_FALSE with invalid literal', async () => {
    await expect(
      createQ({ type: QuestionType.TRUE_FALSE, options: undefined, correctAnswer: ['maybe'] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws for SHORT_ANSWER with empty string answer', async () => {
    await expect(
      createQ({ type: QuestionType.SHORT_ANSWER, options: undefined, correctAnswer: ['  '] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('succeeds for valid SHORT_ANSWER', async () => {
    await expect(
      createQ({ type: QuestionType.SHORT_ANSWER, options: undefined, correctAnswer: ['Paris'] }),
    ).resolves.toBeDefined();
  });

  it('succeeds for valid TRUE_FALSE', async () => {
    await expect(
      createQ({ type: QuestionType.TRUE_FALSE, options: undefined, correctAnswer: ['true'] }),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Issue #57 — sanitizeForRole coverage
// ---------------------------------------------------------------------------
describe('QuizzesService — sanitizeForRole via getQuestionsByLesson (Issue #57)', () => {
  let service: QuizzesService;

  const questionWithAnswers = {
    id: 'q1',
    lessonId: 'l1',
    question: 'Capital of France?',
    type: 'SHORT_ANSWER',
    options: null,
    correctAnswer: ['Paris'],
    explanation: 'France capital',
    points: 1,
    position: 1,
  };

  const mockPrisma = {
    lesson: { findUnique: jest.fn().mockResolvedValue({ id: 'l1' }) },
    quizQuestion: { findMany: jest.fn().mockResolvedValue([questionWithAnswers]) },
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        QuizzesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<QuizzesService>(QuizzesService);
  });

  it('strips correctAnswer and explanation for STUDENT', async () => {
    const results = await service.getQuestionsByLesson('l1', UserRole.STUDENT);
    expect(results[0]).not.toHaveProperty('correctAnswer');
    expect(results[0]).not.toHaveProperty('explanation');
  });

  it('preserves correctAnswer and explanation for INSTRUCTOR', async () => {
    const results = await service.getQuestionsByLesson('l1', UserRole.INSTRUCTOR);
    expect(results[0]).toHaveProperty('correctAnswer');
    expect(results[0]).toHaveProperty('explanation');
  });

  it('preserves correctAnswer and explanation for ADMIN', async () => {
    const results = await service.getQuestionsByLesson('l1', UserRole.ADMIN);
    expect(results[0]).toHaveProperty('correctAnswer');
    expect(results[0]).toHaveProperty('explanation');
  });
});
