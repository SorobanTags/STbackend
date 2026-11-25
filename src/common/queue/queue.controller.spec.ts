import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ROLES_KEY, RolesGuard } from '../guards/roles.guard';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';

describe('QueueController', () => {
  let controller: QueueController;
  const mockQueueService = {
    getJobStatus: jest.fn(),
    getQueueMetrics: jest.fn(),
    listDeadLetterJobs: jest.fn(),
    requeueDeadLetterJob: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QueueController],
      providers: [{ provide: QueueService, useValue: mockQueueService }],
    }).compile();

    controller = module.get(QueueController);
  });

  describe('RolesGuard – admin-only endpoints require ADMIN role', () => {
    function makeContext(role: UserRole): ExecutionContext {
      return {
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
        getHandler: () => handler,
        getClass: () => QueueController,
      } as unknown as ExecutionContext;
    }

    const reflector = {
      getAllAndOverride: (key: string, targets: any[]) =>
        Reflect.getMetadata(key, targets[0]),
    } as any;

    const guard = new RolesGuard(reflector);

    for (const handler of [
      QueueController.prototype.getQueueMetrics,
      QueueController.prototype.getDeadLetterJobs,
      QueueController.prototype.requeueDeadLetterJob,
    ]) {
      it(`${handler.name} – non-admin role is rejected`, () => {
        const ctx = makeContext(UserRole.STUDENT);
        expect(guard.canActivate(ctx)).toBe(false);
      });

      it(`${handler.name} – ADMIN role is allowed`, () => {
        const ctx = makeContext(UserRole.ADMIN);
        expect(guard.canActivate(ctx)).toBe(true);
      });

      it(`${handler.name} – is decorated with @Roles(ADMIN)`, () => {
        const roles = Reflect.getMetadata(ROLES_KEY, handler);
        expect(roles).toEqual([UserRole.ADMIN]);
      });
    }
  });

  describe('getJobStatus', () => {
    it('forwards userId from @CurrentUser to QueueService.getJobStatus', async () => {
      mockQueueService.getJobStatus.mockResolvedValue({ id: 'job-1', status: 'waiting' });
      await controller.getJobStatus('job-1', 'user-99');
      expect(mockQueueService.getJobStatus).toHaveBeenCalledWith('job-1', 'user-99');
    });
  });
});
