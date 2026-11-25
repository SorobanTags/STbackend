import { ExecutionContext, StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor';

function makeContext(skip = false): ExecutionContext {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(skip) } as any;
  const interceptor = new TransformInterceptor(reflector);
  (interceptor as any)._reflector = reflector;

  const ctx = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
  } as unknown as ExecutionContext;
  return ctx;
}

function runInterceptor(data: unknown, skip = false): Promise<unknown> {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(skip) } as any;
  const interceptor = new TransformInterceptor(reflector);
  const ctx = { getHandler: jest.fn(), getClass: jest.fn() } as unknown as ExecutionContext;
  const next = { handle: () => of(data) } as any;
  return new Promise((resolve) => {
    interceptor.intercept(ctx, next).subscribe(resolve);
  });
}

describe('TransformInterceptor', () => {
  it('wraps a plain object as { success, data, timestamp }', async () => {
    const result = await runInterceptor({ id: 1 }) as any;
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 1 });
    expect(typeof result.timestamp).toBe('string');
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  it('returns a StreamableFile instance unwrapped', async () => {
    const file = new StreamableFile(Buffer.from('bytes'));
    const result = await runInterceptor(file);
    expect(result).toBe(file);
  });

  it('returns a payload that already has a boolean success property unwrapped', async () => {
    const payload = { success: false, statusCode: 429, message: 'Too Many Requests' };
    const result = await runInterceptor(payload);
    expect(result).toEqual(payload);
  });

  it('returns data unwrapped when handler is decorated with @SkipTransform()', async () => {
    const data = { raw: true };
    const result = await runInterceptor(data, true);
    expect(result).toEqual(data);
  });
});
