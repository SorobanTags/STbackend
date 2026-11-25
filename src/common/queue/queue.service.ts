import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import {
  CERTIFICATE_PDF_QUEUE,
  NOTIFICATION_EMAIL_QUEUE,
  VIDEO_PROCESSING_QUEUE,
} from './queue.constants';

export interface QueueJobStatus {
  id: string;
  name: string;
  state: string;
  attemptsMade: number;
  failedReason?: string;
  timestamp?: number;
  processedOn?: number;
  finishedOn?: number;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(NOTIFICATION_EMAIL_QUEUE)
    private readonly notificationEmailQueue: Queue,
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly videoProcessingQueue: Queue,
    @InjectQueue(CERTIFICATE_PDF_QUEUE)
    private readonly certificatePdfQueue: Queue,
  ) {}

  private getQueue(name: string): Queue {
    switch (name) {
      case NOTIFICATION_EMAIL_QUEUE:
        return this.notificationEmailQueue;
      case VIDEO_PROCESSING_QUEUE:
        return this.videoProcessingQueue;
      case CERTIFICATE_PDF_QUEUE:
        return this.certificatePdfQueue;
      default:
        throw new NotFoundException(`Unknown queue: ${name}`);
    }
  }

  async getJobStatus(queueName: string, jobId: string): Promise<QueueJobStatus> {
    const queue = this.getQueue(queueName);
    const job = await queue.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found in queue ${queueName}`);
    }
    return this.toStatus(job, await job.getState());
  }

  async listFailedJobs(queueName: string, limit = 50): Promise<QueueJobStatus[]> {
    const queue = this.getQueue(queueName);
    const jobs = await queue.getFailed(0, limit - 1);
    return Promise.all(jobs.map(async (job) => this.toStatus(job, 'failed')));
  }

  async requeueDeadLetterJob(queueName: string, jobId: string): Promise<QueueJobStatus> {
    const queue = this.getQueue(queueName);
    const job = await queue.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found in queue ${queueName}`);
    }

    const state = await job.getState();
    if (state !== 'failed') {
      throw new NotFoundException(`Job ${jobId} is not in the failed (dead-letter) set`);
    }

    // BullMQ's retry() moves the job back to waiting but preserves attemptsMade,
    // so an exhausted job would fail again immediately. Reset the attempt
    // counter first so the job gets a fresh retry budget.
    await job.updateData(job.data);
    job.attemptsMade = 0;
    await job.retry('failed');

    this.logger.log(`Requeued dead-letter job ${jobId} from queue ${queueName}`);

    const refreshed = await queue.getJob(jobId);
    if (!refreshed) {
      throw new NotFoundException(`Job ${jobId} not found in queue ${queueName}`);
    }
    return this.toStatus(refreshed, await refreshed.getState());
  }

  private toStatus(job: Job, state: string): QueueJobStatus {
    return {
      id: String(job.id),
      name: job.name,
      state,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    };
  }
}
