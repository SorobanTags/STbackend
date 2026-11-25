import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import {
  CERTIFICATE_PDF_QUEUE,
  NOTIFICATION_EMAIL_QUEUE,
  VIDEO_PROCESSING_QUEUE,
} from './queue.constants';

describe('QueueService', () => {
  let service: QueueService;
  let notificationEmailQueue: any;
  let videoProcessingQueue: any;
  let certificatePdfQueue: any;

  beforeEach(async () => {
    notificationEmailQueue = {
      getJob: jest.fn(),
      getFailed: jest.fn(),
    };
    videoProcessingQueue = {
      getJob: jest.fn(),
      getFailed: jest.fn(),
    };
    certificatePdfQueue = {
      getJob: jest.fn(),
      getFailed: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        QueueService,
        { provide: getQueueToken(NOTIFICATION_EMAIL_QUEUE), useValue: notificationEmailQueue },
        { provide: getQueueToken(VIDEO_PROCESSING_QUEUE), useValue: videoProcessingQueue },
        { provide: getQueueToken(CERTIFICATE_PDF_QUEUE), useValue: certificatePdfQueue },
      ],
    }).compile();

    service = moduleRef.get(QueueService);
  });

  describe('getJobStatus', () => {
    it('returns the status of an existing job', async () => {
      const job = {
        id: '1',
        name: 'send-notification-email',
        attemptsMade: 1,
        failedReason: undefined,
        timestamp: 1000,
        processedOn: 2000,
        finishedOn: undefined,
        getState: jest.fn().mockResolvedValue('active'),
      };
      notificationEmailQueue.getJob.mockResolvedValue(job);

      const status = await service.getJobStatus(NOTIFICATION_EMAIL_QUEUE, '1');

      expect(status).toEqual({
        id: '1',
        name: 'send-notification-email',
        state: 'active',
        attemptsMade: 1,
        failedReason: undefined,
        timestamp: 1000,
        processedOn: 2000,
        finishedOn: undefined,
      });
    });

    it('throws when the job does not exist', async () => {
      notificationEmailQueue.getJob.mockResolvedValue(undefined);

      await expect(service.getJobStatus(NOTIFICATION_EMAIL_QUEUE, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws for an unknown queue', async () => {
      await expect(service.getJobStatus('unknown-queue', '1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('listFailedJobs', () => {
    it('maps failed jobs to statuses', async () => {
      const job = {
        id: '2',
        name: 'process-video',
        attemptsMade: 5,
        failedReason: 'boom',
        timestamp: 1000,
        processedOn: 2000,
        finishedOn: 3000,
      };
      videoProcessingQueue.getFailed.mockResolvedValue([job]);

      const statuses = await service.listFailedJobs(VIDEO_PROCESSING_QUEUE);

      expect(statuses).toHaveLength(1);
      expect(statuses[0]).toMatchObject({ id: '2', state: 'failed', attemptsMade: 5 });
    });
  });

  describe('requeueDeadLetterJob', () => {
    it('resets attemptsMade and requeues an exhausted job', async () => {
      const job: any = {
        id: '3',
        name: 'send-notification-email',
        attemptsMade: 5,
        failedReason: 'boom',
        timestamp: 1000,
        processedOn: 2000,
        finishedOn: 3000,
        data: { to: 'user@example.com' },
        getState: jest.fn().mockResolvedValue('failed'),
        updateData: jest.fn().mockResolvedValue(undefined),
        retry: jest.fn().mockImplementation(async () => {
          job.attemptsMade = 0;
          job.getState.mockResolvedValue('waiting');
        }),
      };
      notificationEmailQueue.getJob.mockResolvedValue(job);

      const status = await service.requeueDeadLetterJob(NOTIFICATION_EMAIL_QUEUE, '3');

      expect(job.updateData).toHaveBeenCalledWith(job.data);
      expect(job.retry).toHaveBeenCalledWith('failed');
      expect(status.attemptsMade).toBe(0);
      expect(status.state).toBe('waiting');
    });

    it('throws when the job is not in the failed set', async () => {
      const job: any = {
        id: '4',
        getState: jest.fn().mockResolvedValue('completed'),
      };
      notificationEmailQueue.getJob.mockResolvedValue(job);

      await expect(
        service.requeueDeadLetterJob(NOTIFICATION_EMAIL_QUEUE, '4'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when the job does not exist', async () => {
      notificationEmailQueue.getJob.mockResolvedValue(undefined);

      await expect(
        service.requeueDeadLetterJob(NOTIFICATION_EMAIL_QUEUE, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
