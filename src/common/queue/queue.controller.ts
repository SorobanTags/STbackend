import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../guards/roles.guard';
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
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Get aggregated job counts per registered queue' })
  getQueueMetrics() {
    return this.queueService.getQueueMetrics();
  }

  @Get('dead-letter')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'List permanently-failed (dead-letter) jobs across queues' })
  getDeadLetterJobs() {
    return this.queueService.listDeadLetterJobs();
  }

  @Post('dead-letter/:queueName/:id/requeue')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Manually requeue a permanently-failed job' })
  requeueDeadLetterJob(
    @Param('queueName') queueName: string,
    @Param('id') jobId: string,
  ) {
    return this.queueService.requeueDeadLetterJobByName(queueName, jobId);
  }
}
