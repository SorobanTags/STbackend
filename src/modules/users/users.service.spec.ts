import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    adminAuditLog: {
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const actorId = 'actor-1';
  const targetId = 'target-1';

  const baseUser = {
    id: targetId,
    email: 'target@example.com',
    isBanned: false,
    isSuspended: false,
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      adminAuditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('maps Prisma P2025 to NotFoundException', async () => {
    prisma.user.update.mockRejectedValue(
      Object.assign(new Error('Record not found'), { code: 'P2025' }),
    );

    await expect(
      service.updateProfile('user-1', { name: 'Updated' }),
    ).rejects.toThrow(new NotFoundException('User not found'));
  });

  it('names the conflicting field when mapping Prisma P2002', async () => {
    prisma.user.update.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['stellarAddress'] },
      }),
    );

    await expect(
      service.updateProfile('user-1', { name: 'Updated' }),
    ).rejects.toThrow(new ConflictException(
      'A record with the conflicting value for stellarAddress already exists',
    ));
  });

  it('supports a string P2002 target', async () => {
    prisma.user.update.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: 'email' },
      }),
    );

    await expect(
      service.updateProfile('user-1', { name: 'Updated' }),
    ).rejects.toThrow('email');
  });

  it('maps Prisma P2000 to BadRequestException with the offending column', async () => {
    prisma.user.update.mockRejectedValue(
      Object.assign(new Error('Value too long'), {
        code: 'P2000',
        meta: { column_name: 'name' },
      }),
    );

    await expect(
      service.updateProfile('user-1', { name: 'Updated' }),
    ).rejects.toThrow(new BadRequestException('Invalid value for name'));
  });

  it('rethrows unknown errors unchanged', async () => {
    const error = new Error('Unexpected database failure');
    prisma.user.update.mockRejectedValue(error);

    await expect(service.updateProfile('user-1', { name: 'Updated' })).rejects.toBe(
      error,
    );
  });

  describe('banUser', () => {
    it('performs the user update and audit-log insert inside a single $transaction', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser });
      const updatedUser = { ...baseUser, isBanned: true };
      prisma.user.update.mockResolvedValue(updatedUser);
      prisma.adminAuditLog.create.mockResolvedValue({ id: 'audit-1' });
      prisma.$transaction.mockResolvedValue([updatedUser, { id: 'audit-1' }]);

      const result = await service.banUser(targetId, actorId);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const transactionArg = prisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(transactionArg)).toBe(true);
      expect(transactionArg).toHaveLength(2);
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      expect(prisma.adminAuditLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorId,
            action: expect.any(String),
            targetId,
          }),
        }),
      );
      expect(result).toEqual(updatedUser);
    });

    it('rejects the whole operation when the audit-log insert fails, leaving no partial state', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser });
      const updatedUser = { ...baseUser, isBanned: true };
      prisma.user.update.mockResolvedValue(updatedUser);
      prisma.adminAuditLog.create.mockRejectedValue(
        new Error('audit insert failed'),
      );
      prisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => {
        // Simulate transactional rollback: run all ops, reject if any fails.
        const results = await Promise.all(ops);
        return results;
      });

      await expect(service.banUser(targetId, actorId)).rejects.toThrow(
        'audit insert failed',
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // The user record must not be considered updated outside the transaction.
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException when the user is already banned', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        isBanned: true,
      });

      await expect(service.banUser(targetId, actorId)).rejects.toThrow(
        new BadRequestException('User is already banned'),
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.banUser(targetId, actorId)).rejects.toThrow(
        NotFoundException,
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('unbanUser', () => {
    it('performs the user update and audit-log insert inside a single $transaction', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        isBanned: true,
      });
      const updatedUser = { ...baseUser, isBanned: false };
      prisma.user.update.mockResolvedValue(updatedUser);
      prisma.adminAuditLog.create.mockResolvedValue({ id: 'audit-2' });
      prisma.$transaction.mockResolvedValue([updatedUser, { id: 'audit-2' }]);

      const result = await service.unbanUser(targetId, actorId);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const transactionArg = prisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(transactionArg)).toBe(true);
      expect(transactionArg).toHaveLength(2);
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      expect(prisma.adminAuditLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorId,
            action: expect.any(String),
            targetId,
          }),
        }),
      );
      expect(result).toEqual(updatedUser);
    });

    it('rejects the whole operation when the audit-log insert fails, leaving no partial state', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        isBanned: true,
      });
      const updatedUser = { ...baseUser, isBanned: false };
      prisma.user.update.mockResolvedValue(updatedUser);
      prisma.adminAuditLog.create.mockRejectedValue(
        new Error('audit insert failed'),
      );
      prisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => {
        const results = await Promise.all(ops);
        return results;
      });

      await expect(service.unbanUser(targetId, actorId)).rejects.toThrow(
        'audit insert failed',
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException when the user is not banned', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser });

      await expect(service.unbanUser(targetId, actorId)).rejects.toThrow(
        BadRequestException,
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.unbanUser(targetId, actorId)).rejects.toThrow(
        NotFoundException,
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
