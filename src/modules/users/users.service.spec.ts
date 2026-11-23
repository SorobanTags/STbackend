import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService.updateProfile', () => {
  let service: UsersService;
  const prisma = {
    user: {
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    prisma.user.update.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(UsersService);
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
});
