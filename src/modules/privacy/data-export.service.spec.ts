import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { DataExportService } from './data-export.service';
import { PrismaService } from '../../common/prisma/prisma.service';

type DelegateMock = jest.Mock<Promise<unknown[]>, [unknown?]>;

const EXPORT_SECTIONS = [
  'user',
  'profile',
  'sessions',
  'messages',
  'notifications',
  'transactions',
  'reviews',
  'files',
  'auditLogs',
  'consents',
] as const;

function buildPrismaMock() {
  const delegates: Record<string, DelegateMock> = {};
  for (const section of EXPORT_SECTIONS) {
    delegates[section] = jest.fn().mockResolvedValue([]);
  }

  const dataExportJob = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  };

  return {
    delegates,
    prisma: {
      dataExportJob,
      user: delegates.user,
      profile: delegates.profile,
      session: delegates.sessions,
      message: delegates.messages,
      notification: delegates.notifications,
      transaction: delegates.transactions,
      review: delegates.reviews,
      file: delegates.files,
      auditLog: delegates.auditLogs,
      consent: delegates.consents,
    } as unknown as PrismaService,
  };
}

describe('DataExportService', () => {
  let service: DataExportService;
  let prismaMock: ReturnType<typeof buildPrismaMock>;

  const USER_A = 'user-a';
  const USER_B = 'user-b';
  const NOW = new Date('2024-06-01T12:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    prismaMock = buildPrismaMock();
    service = new DataExportService(prismaMock.prisma);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('requestExport cooldown', () => {
    it('rejects a second request inside the COOLDOWN_HOURS window', async () => {
      prismaMock.prisma.dataExportJob.findFirst.mockResolvedValueOnce(null);
      prismaMock.prisma.dataExportJob.create.mockResolvedValueOnce({
        id: 'job-1',
        userId: USER_A,
        status: 'PENDING',
        createdAt: NOW,
      });

      await service.requestExport(USER_A);

      // A recent job exists within the cooldown window.
      prismaMock.prisma.dataExportJob.findFirst.mockResolvedValueOnce({
        id: 'job-1',
        userId: USER_A,
        status: 'PENDING',
        createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      });

      await expect(service.requestExport(USER_A)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('downloadExport retention', () => {
    it('rejects a job older than EXPORT_RETENTION_DAYS', async () => {
      const expired = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000);
      prismaMock.prisma.dataExportJob.findUnique.mockResolvedValueOnce({
        id: 'job-old',
        userId: USER_A,
        status: 'COMPLETED',
        completedAt: expired,
        payload: { user: {} },
      });

      await expect(service.downloadExport(USER_A, 'job-old')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('cross-user access', () => {
    it('does not let another user read the job status', async () => {
      prismaMock.prisma.dataExportJob.findUnique.mockResolvedValueOnce({
        id: 'job-a',
        userId: USER_A,
        status: 'COMPLETED',
        completedAt: NOW,
      });

      await expect(service.getExportStatus(USER_B, 'job-a')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('does not let another user download the job', async () => {
      prismaMock.prisma.dataExportJob.findUnique.mockResolvedValueOnce({
        id: 'job-a',
        userId: USER_A,
        status: 'COMPLETED',
        completedAt: NOW,
        payload: { user: {} },
      });

      await expect(service.downloadExport(USER_B, 'job-a')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('EXPORT_SECTIONS fan-out', () => {
    it('invokes every delegate exactly once for a completed export', async () => {
      prismaMock.prisma.dataExportJob.findFirst.mockResolvedValueOnce(null);
      prismaMock.prisma.dataExportJob.create.mockResolvedValueOnce({
        id: 'job-1',
        userId: USER_A,
        status: 'PENDING',
        createdAt: NOW,
      });
      prismaMock.prisma.dataExportJob.update.mockResolvedValueOnce({
        id: 'job-1',
        userId: USER_A,
        status: 'COMPLETED',
        completedAt: NOW,
      });

      await service.requestExport(USER_A);

      for (const section of EXPORT_SECTIONS) {
        expect(prismaMock.delegates[section]).toHaveBeenCalledTimes(1);
      }
    });
  });
});
