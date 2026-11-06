import { Test, TestingModule } from '@nestjs/testing';
import { LiveSessionsService } from './live-sessions.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConflictException } from '@nestjs/common';
import { LiveSessionStatus } from '@prisma/client';

describe('LiveSessionsService', () => {
  let service: LiveSessionsService;

  const mockPrisma = {
    course: { findUnique: jest.fn() },
    liveSession: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveSessionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<LiveSessionsService>(LiveSessionsService);
    jest.clearAllMocks();
  });

  it('should schedule a session when instructor is available', async () => {
    const user = { id: 'inst-1', stellarAddress: 'G_INST_1' };
    mockPrisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      instructorAddress: 'G_INST_1',
      instructor: { id: 'inst-1' },
    });
    mockPrisma.liveSession.findMany.mockResolvedValue([]);
    mockPrisma.liveSession.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'sess-1', ...data }),
    );

    const result = await service.scheduleSession(user, {
      courseId: 'course-1',
      title: 'Live Workshop',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    });

    expect(result.id).toBe('sess-1');
    expect(result.status).toBe(LiveSessionStatus.SCHEDULED);
  });

  it('should throw ConflictException if instructor has an overlapping session', async () => {
    const user = { id: 'inst-1', stellarAddress: 'G_INST_1' };
    const startTime = new Date(Date.now() + 86400000);

    mockPrisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      instructorAddress: 'G_INST_1',
      instructor: { id: 'inst-1' },
    });
    mockPrisma.liveSession.findMany.mockResolvedValue([
      {
        id: 'sess-existing',
        title: 'Existing Session',
        scheduledAt: startTime,
        durationMinutes: 60,
        status: LiveSessionStatus.SCHEDULED,
      },
    ]);

    await expect(
      service.scheduleSession(user, {
        courseId: 'course-1',
        title: 'Conflicting Session',
        scheduledAt: startTime.toISOString(),
        durationMinutes: 60,
      }),
    ).rejects.toThrow(ConflictException);
  });
});
