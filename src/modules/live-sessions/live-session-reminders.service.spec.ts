import { Test, TestingModule } from '@nestjs/testing';
import { LiveSessionRemindersService } from './live-session-reminders.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LiveSessionStatus, NotificationType } from '@prisma/client';

describe('LiveSessionRemindersService', () => {
  let service: LiveSessionRemindersService;

  const mockPrisma = {
    liveSession: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockNotifications = {
    notifyUser: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveSessionRemindersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<LiveSessionRemindersService>(
      LiveSessionRemindersService,
    );
    jest.clearAllMocks();
  });

  it('should send reminders for upcoming non-cancelled sessions and set reminderSent', async () => {
    const session = {
      id: 'sess-1',
      title: 'Intro Live',
      courseId: 'course-1',
      scheduledAt: new Date(Date.now() + 1800000), // 30 minutes from now
      status: LiveSessionStatus.SCHEDULED,
      reminderSent: false,
      course: {
        title: 'Masterclass',
        enrollments: [
          { student: { id: 'student-1', email: 'student1@example.com' } },
        ],
      },
    };

    mockPrisma.liveSession.findMany.mockResolvedValue([session]);
    mockNotifications.notifyUser.mockResolvedValue({});
    mockPrisma.liveSession.update.mockResolvedValue({});

    const result = await service.handleUpcomingSessionReminders();

    expect(result.sessionsProcessed).toBe(1);
    expect(result.notificationsSent).toBe(1);
    expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
      'student-1',
      NotificationType.LIVE_SESSION_REMINDER,
      expect.stringContaining('Upcoming Live Session'),
      expect.any(String),
      expect.any(Object),
    );
    expect(mockPrisma.liveSession.update).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: { reminderSent: true },
    });
  });
});
