import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { NOTIFICATION_EMAIL_QUEUE } from './queue.constants';
import { QueueService } from './queue.service';

@ApiTags('queue')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get('jobs/:id')
  @ApiOperation({ summary: 'Get the status of an enqueued job' })
  getJobStatus(@Param('id') jobId: string, @CurrentUser('id') userId: string) {
    return this.queueService.getJobStatus(jobId, userId);
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get aggregated job counts per registered queue' })
  getQueueMetrics() {
    return this.queueService.getQueueMetrics();
  }

  @Get('dead-letter')
  @ApiOperation({ summary: 'List permanently-failed (dead-letter) jobs across queues' })
  getDeadLetterJobs() {
    return this.queueService.listDeadLetterJobs();
  }

  @Post('dead-letter/:queueName/:id/requeue')
  @ApiOperation({ summary: 'Manually requeue a permanently-failed job' })
  requeueDeadLetterJob(
    @Param('queueName') queueName: string,
    @Param('id') jobId: string,
  ) {
    if (queueName !== NOTIFICATION_EMAIL_QUEUE) {
      throw new NotFoundException('Queue not found');
    }
    return this.queueService.requeueDeadLetterJob(jobId);
  }
}
