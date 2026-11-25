import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CoursesService } from '../courses/courses.service';
import { EventsService, EVENT_POLLER_CHECKPOINT_KEY } from './events.service';

describe('EventsService — ledger checkpoint (Issue #80)', () => {
  let service: EventsService;

  const mockPrisma = {
    eventPollerCheckpoint: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    chainEvent: {
      create: jest.fn(),
    },
  };

  const mockStellar = {
    getLatestLedger: jest.fn(),
    fetchContractEvents: jest.fn(),
  };

  const mockNotifications = { notifyUser: jest.fn() };
  const mockCourses = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StellarService, useValue: mockStellar },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: CoursesService, useValue: mockCourses },
      ],
    }).compile();

    service = module.get(EventsService);
    jest.clearAllMocks();
    mockPrisma.eventPollerCheckpoint.upsert.mockResolvedValue({});
    mockPrisma.eventPollerCheckpoint.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.chainEvent.create.mockResolvedValue({});
  });

  describe('onModuleInit — resume from checkpoint', () => {
    it('resumes from the persisted ledger instead of the chain tip', async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockResolvedValue({
        key: EVENT_POLLER_CHECKPOINT_KEY,
        lastProcessedLedger: 4242,
      });
      mockStellar.getLatestLedger.mockResolvedValue(9999);

      await service.onModuleInit();

      const status = await service.getCheckpointStatus();
      expect(status.lastProcessedLedger).toBe(4242);
      expect(status.resumedFromCheckpoint).toBe(true);
    });

    it('cold-starts near the chain tip and writes an initial checkpoint when none exists', async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockResolvedValue(null);
      mockStellar.getLatestLedger.mockResolvedValue(1000);

      await service.onModuleInit();

      const status = await service.getCheckpointStatus();
      expect(status.lastProcessedLedger).toBe(990); // 1000 - COLD_START_LOOKBACK
      expect(status.resumedFromCheckpoint).toBe(false);
      expect(mockPrisma.eventPollerCheckpoint.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: EVENT_POLLER_CHECKPOINT_KEY },
        }),
      );
    });

    it('ignores a checkpoint that points past the chain tip (stale / wrong network)', async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockResolvedValue({
        key: EVENT_POLLER_CHECKPOINT_KEY,
        lastProcessedLedger: 50_000,
      });
      mockStellar.getLatestLedger.mockResolvedValue(1000);

      await service.onModuleInit();

      const status = await service.getCheckpointStatus();
      expect(status.lastProcessedLedger).toBe(990);
      expect(status.resumedFromCheckpoint).toBe(false);
    });
  });

  describe('pollEvents — checkpoint writes after each poll', () => {
    beforeEach(async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockResolvedValue(null);
      mockStellar.getLatestLedger.mockResolvedValue(100);
      await service.onModuleInit();
      jest.clearAllMocks();
      mockPrisma.eventPollerCheckpoint.upsert.mockResolvedValue({});
      mockPrisma.chainEvent.create.mockResolvedValue({});
    });

    it('advances and persists the ledger after processing events', async () => {
      mockStellar.fetchContractEvents.mockResolvedValue([
        { ledger: 105, topic: ['course_registered'], value: 'COURSE-1', txHash: 'a' },
        { ledger: 107, topic: ['course_registered'], value: 'COURSE-2', txHash: 'b' },
      ]);

      await service.pollEvents();

      expect(mockPrisma.eventPollerCheckpoint.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ lastProcessedLedger: 108 }),
        }),
      );
      const status = await service.getCheckpointStatus();
      expect(status.lastProcessedLedger).toBe(108);
    });

    it('still writes a checkpoint when a poll finds no events', async () => {
      mockStellar.fetchContractEvents.mockResolvedValue([]);

      await service.pollEvents();

      expect(mockPrisma.eventPollerCheckpoint.upsert).toHaveBeenCalledTimes(1);
    });

    it('does not advance the checkpoint when fetchContractEvents rejects, then resumes on the next healthy poll', async () => {
      const loggerErrorSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);

      mockStellar.fetchContractEvents.mockRejectedValueOnce(
        new Error('rpc unavailable'),
      );

      await expect(service.pollEvents()).resolves.not.toThrow();

      expect(mockPrisma.eventPollerCheckpoint.upsert).not.toHaveBeenCalled();
      expect(loggerErrorSpy).toHaveBeenCalled();
      const statusAfterFailure = await service.getCheckpointStatus();
      expect(statusAfterFailure.lastProcessedLedger).toBe(100);

      mockStellar.fetchContractEvents.mockResolvedValueOnce([]);
      await service.pollEvents();

      expect(mockPrisma.eventPollerCheckpoint.upsert).toHaveBeenCalledTimes(1);
      loggerErrorSpy.mockRestore();
    });
  });

  describe('pollEvents — checkpoint write failures do not block polling', () => {
    beforeEach(async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockResolvedValue(null);
      mockStellar.getLatestLedger.mockResolvedValue(100);
      await service.onModuleInit();
      jest.clearAllMocks();
      mockPrisma.chainEvent.create.mockResolvedValue({});
    });

    it('swallows the write error, records the failure and keeps advancing in memory', async () => {
      mockStellar.fetchContractEvents.mockResolvedValue([
        { ledger: 110, topic: ['course_registered'], value: 'COURSE-1', txHash: 'a' },
      ]);
      mockPrisma.eventPollerCheckpoint.upsert.mockRejectedValue(new Error('db down'));
      mockPrisma.eventPollerCheckpoint.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.pollEvents()).resolves.not.toThrow();

      const status = await service.getCheckpointStatus();
      expect(status.consecutiveWriteFailures).toBe(1);
      expect(status.lastWriteError).toContain('db down');
      expect(status.healthy).toBe(false);
      // in-memory progress is not lost
      expect(status.lastProcessedLedger).toBe(111);
    });

    it('recovers (failure counter resets) once a later write succeeds', async () => {
      mockStellar.fetchContractEvents.mockResolvedValue([]);
      mockPrisma.eventPollerCheckpoint.upsert
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce({});
      mockPrisma.eventPollerCheckpoint.updateMany.mockResolvedValue({ count: 1 });

      await service.pollEvents();
      expect((await service.getCheckpointStatus()).consecutiveWriteFailures).toBe(1);

      await service.pollEvents();
      const status = await service.getCheckpointStatus();
      expect(status.consecutiveWriteFailures).toBe(0);
      expect(status.healthy).toBe(true);
    });
  });

  describe('getCheckpointStatus', () => {
    it('reports the persisted ledger from the database', async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockResolvedValue({
        key: EVENT_POLLER_CHECKPOINT_KEY,
        lastProcessedLedger: 777,
        lastPolledAt: new Date('2026-08-27T00:00:00Z'),
      });

      const status = await service.getCheckpointStatus();
      expect(status.persistedLedger).toBe(777);
      expect(status.key).toBe(EVENT_POLLER_CHECKPOINT_KEY);
    });
  });

  describe('onModuleInit — failed chain-tip fetch (Issue #16)', () => {
    it('does not call persistCheckpoint when getLatestLedger rejects', async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockResolvedValue(null);
      mockStellar.getLatestLedger.mockRejectedValue(new Error('RPC unreachable'));

      await service.onModuleInit();

      expect(mockPrisma.eventPollerCheckpoint.upsert).not.toHaveBeenCalled();
    });

    it('reports resumedFromCheckpoint as false after a failed-tip cold start', async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockResolvedValue(null);
      mockStellar.getLatestLedger.mockRejectedValue(new Error('RPC unreachable'));

      await service.onModuleInit();

      const status = await service.getCheckpointStatus();
      expect(status.resumedFromCheckpoint).toBe(false);
    });

    it('pollEvents resolves the tip on the first tick and then persists a checkpoint', async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockResolvedValue(null);
      mockStellar.getLatestLedger
        .mockRejectedValueOnce(new Error('RPC unreachable')) // fails during onModuleInit
        .mockResolvedValueOnce(500);                         // succeeds during first pollEvents

      await service.onModuleInit();
      // After failed init, lastProcessedLedger is still 0 → no checkpoint written.
      expect(mockPrisma.eventPollerCheckpoint.upsert).not.toHaveBeenCalled();

      jest.clearAllMocks();
      mockPrisma.eventPollerCheckpoint.upsert.mockResolvedValue({});
      mockPrisma.eventPollerCheckpoint.updateMany.mockResolvedValue({ count: 1 });
      mockStellar.fetchContractEvents.mockResolvedValue([]);

      await service.pollEvents();

      // Should have written checkpoint at 500 - COLD_START_LOOKBACK = 490.
      expect(mockPrisma.eventPollerCheckpoint.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ lastProcessedLedger: 490 }),
        }),
      );
      const status = await service.getCheckpointStatus();
      expect(status.lastProcessedLedger).toBe(490);
    });
  });
});
