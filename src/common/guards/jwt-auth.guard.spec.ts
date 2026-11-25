import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let authCanActivateSpy: jest.SpyInstance;

  const prisma = {
    session: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const createContext = (user: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as ExecutionContext;

  beforeEach(async () => {
    prisma.session.findUnique.mockReset();
    prisma.session.update.mockReset().mockResolvedValue(undefined);
    authCanActivateSpy = jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    guard = module.get(JwtAuthGuard);
  });

  afterEach(() => {
    authCanActivateSpy.mockRestore();
  });

  it('rejects a token without a user id', async () => {
    await expect(guard.canActivate(createContext({}))).rejects.toThrow(
      new UnauthorizedException('Invalid token payload'),
    );
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a revoked session', async () => {
    prisma.session.findUnique.mockResolvedValue({
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      guard.canActivate(createContext({ id: 'user-1', jti: 'session-1' })),
    ).rejects.toThrow(new UnauthorizedException('Session has been revoked'));
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it('rejects an expired session', async () => {
    prisma.session.findUnique.mockResolvedValue({
      revokedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(
      guard.canActivate(createContext({ id: 'user-1', jti: 'session-1' })),
    ).rejects.toThrow(new UnauthorizedException('Session has expired'));
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it('allows a valid session and updates its last activity', async () => {
    prisma.session.findUnique.mockResolvedValue({
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      guard.canActivate(createContext({ id: 'user-1', jti: 'session-1' })),
    ).resolves.toBe(true);
    expect(prisma.session.update).toHaveBeenCalledWith({
      where: { jti: 'session-1' },
      data: { lastActiveAt: expect.any(Date) },
    });
  });

  it('allows a token without a jti without querying Prisma', async () => {
    await expect(guard.canActivate(createContext({ id: 'user-1' }))).resolves.toBe(
      true,
    );
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
    expect(prisma.session.update).not.toHaveBeenCalled();
  });
});
