import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { RoleThrottlerGuard } from './role-throttler.guard';

describe('RoleThrottlerGuard', () => {
  const configValues: Record<string, number | string> = {
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    ROLE_THROTTLE_WINDOW_MS: 5000,
    ROLE_THROTTLE_ANON_LIMIT: 1,
    ROLE_THROTTLE_STUDENT_LIMIT: 2,
    ROLE_THROTTLE_INSTRUCTOR_LIMIT: 4,
    ROLE_THROTTLE_ADMIN_LIMIT: 8,
  };
  let guard: RoleThrottlerGuard;

  const createContext = (role: string, id: string) => {
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { user: { role, id }, headers: {}, ip: '127.0.0.1' };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as ExecutionContext;

    return { context, response };
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const config = {
      get: jest.fn((key: string, defaultValue?: unknown) =>
        configValues[key] ?? defaultValue,
      ),
    } as unknown as ConfigService;
    guard = new RoleThrottlerGuard(config);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('applies the student limit and configured window TTL', async () => {
    const { context, response } = createContext('STUDENT', 'student-1');

    expect(await guard.canActivate(context)).toBe(true);
    expect(await guard.canActivate(context)).toBe(true);
    expect(await guard.canActivate(context)).toBe(false);

    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 2);
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Reset',
      String(Math.ceil((Date.now() + 5000) / 1000)),
    );
    expect(response.status).toHaveBeenCalledWith(429);
  });

  it('applies the instructor limit and configured window TTL', async () => {
    const { context, response } = createContext('INSTRUCTOR', 'instructor-1');

    for (let count = 0; count < 4; count += 1) {
      expect(await guard.canActivate(context)).toBe(true);
    }
    expect(await guard.canActivate(context)).toBe(false);

    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 4);
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Reset',
      String(Math.ceil((Date.now() + 5000) / 1000)),
    );
    expect(response.status).toHaveBeenCalledWith(429);
  });
});
