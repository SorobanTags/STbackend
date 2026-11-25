import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, lastValueFrom } from 'rxjs';
import { HttpCacheInterceptor } from './cache.interceptor';
import { CacheService } from './cache.service';
import {
  CACHE_NAMESPACE_KEY,
  CACHE_TTL_KEY,
  CACHE_PUBLIC_KEY,
  CACHE_INVALIDATE_KEY,
} from './cache.decorator';

// ── helpers ────────────────────────────────────────────────────────────────

function makeContext({
  method = 'GET',
  user,
  params = {},
  query = {},
  metadata = {} as Record<string, unknown>,
}: {
  method?: string;
  user?: { id: string };
  params?: Record<string, string>;
  query?: Record<string, string>;
  metadata?: Record<string, unknown>;
}): [ExecutionContext, Record<string, string>] {
  const headers: Record<string, string> = {};
  const request = { method, user, params, query };
  const response = { setHeader: (k: string, v: string) => { headers[k] = v; } };

  const ctx = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;

  // Attach metadata look-ups to the reflector mock via closure (see makeReflector)
  (ctx as any).__metadata = metadata;
  return [ctx, headers];
}

function makeReflector(metadata: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: (_key: string, _targets: any[]) => metadata[_key],
  } as unknown as Reflector;
}

function makeHandler(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

// ── Issue #42 — user-scoped cache keys ─────────────────────────────────────

describe('HttpCacheInterceptor — user-scoped keys (Issue #42)', () => {
  let cacheGet: jest.Mock;
  let cacheSet: jest.Mock;
  let cacheService: CacheService;

  beforeEach(() => {
    cacheGet = jest.fn().mockResolvedValue(null);
    cacheSet = jest.fn().mockResolvedValue(undefined);
    cacheService = {
      buildKey: (ns: string, params: Record<string, unknown>) => {
        const parts = Object.keys(params)
          .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
          .sort()
          .map((k) => `${k}=${params[k]}`);
        return `cache:${ns}${parts.length ? ':' + parts.join('&') : ''}`;
      },
      get: cacheGet,
      set: cacheSet,
      invalidateNamespace: jest.fn().mockResolvedValue(undefined),
    } as unknown as CacheService;
  });

  it('produces distinct cache keys for two requests with different user ids', async () => {
    const metadata = {
      [CACHE_NAMESPACE_KEY]: 'courses',
      [CACHE_TTL_KEY]: undefined,
      [CACHE_PUBLIC_KEY]: false,
    };

    const reflector = makeReflector(metadata);
    const interceptor = new HttpCacheInterceptor(cacheService, reflector);

    // User A
    const [ctxA, headersA] = makeContext({ user: { id: 'user-a' }, metadata });
    (ctxA as any).__metadata = metadata;
    const reflectorA = makeReflector({ ...metadata });
    const interceptorA = new HttpCacheInterceptor(cacheService, reflectorA);
    const obsA = await interceptorA.intercept(ctxA, makeHandler('data-a'));
    await lastValueFrom(obsA);
    const keyA = cacheSet.mock.calls[0]?.[0] as string;

    // User B
    const [ctxB] = makeContext({ user: { id: 'user-b' }, metadata });
    cacheGet.mockResolvedValue(null);
    const obsB = await interceptor.intercept(ctxB, makeHandler('data-b'));
    await lastValueFrom(obsB);
    const keyB = cacheSet.mock.calls[1]?.[0] as string;

    expect(keyA).toBeDefined();
    expect(keyB).toBeDefined();
    expect(keyA).not.toBe(keyB);
    expect(headersA['X-Cache-Status']).toBe('MISS');
  });

  it('produces the same key for two users when the endpoint is marked public', async () => {
    const metadata = {
      [CACHE_NAMESPACE_KEY]: 'courses',
      [CACHE_TTL_KEY]: undefined,
      [CACHE_PUBLIC_KEY]: true,
    };
    const reflector = makeReflector(metadata);
    const interceptor = new HttpCacheInterceptor(cacheService, reflector);

    const [ctxA, headersA] = makeContext({ user: { id: 'user-a' }, metadata });
    const obsA = await interceptor.intercept(ctxA, makeHandler('shared'));
    await lastValueFrom(obsA);
    const keyA = cacheSet.mock.calls[0]?.[0] as string;

    cacheGet.mockResolvedValue(null);
    const [ctxB] = makeContext({ user: { id: 'user-b' }, metadata });
    const obsB = await interceptor.intercept(ctxB, makeHandler('shared'));
    await lastValueFrom(obsB);
    const keyB = cacheSet.mock.calls[1]?.[0] as string;

    expect(keyA).toBe(keyB);
  });

  it('sets X-Cache-Status to MISS on first request and HIT on second (same user)', async () => {
    const metadata = {
      [CACHE_NAMESPACE_KEY]: 'courses',
      [CACHE_TTL_KEY]: 60,
      [CACHE_PUBLIC_KEY]: false,
    };
    const reflector = makeReflector(metadata);
    const interceptor = new HttpCacheInterceptor(cacheService, reflector);

    const [ctx1, h1] = makeContext({ user: { id: 'user-x' }, metadata });
    const obs1 = await interceptor.intercept(ctx1, makeHandler('result'));
    await lastValueFrom(obs1);
    expect(h1['X-Cache-Status']).toBe('MISS');

    // Now simulate a cache hit on second request
    const storedKey = cacheSet.mock.calls[0][0] as string;
    cacheGet.mockImplementation(async (k) => (k === storedKey ? 'result' : null));

    const [ctx2, h2] = makeContext({ user: { id: 'user-x' }, metadata });
    const obs2 = await interceptor.intercept(ctx2, makeHandler('result'));
    await lastValueFrom(obs2);
    expect(h2['X-Cache-Status']).toBe('HIT');
  });
});

// ── Issue #41 — no unhandled rejection on cache.set failure ────────────────

describe('HttpCacheInterceptor — cache write error handling (Issue #41)', () => {
  it('does not propagate an unhandled rejection when cache.set rejects', async () => {
    const failingSet = jest.fn().mockRejectedValue(new Error('Redis down'));
    const cacheService = {
      buildKey: (ns: string) => `cache:${ns}`,
      get: jest.fn().mockResolvedValue(null),
      set: failingSet,
      invalidateNamespace: jest.fn(),
    } as unknown as CacheService;

    const metadata = { [CACHE_NAMESPACE_KEY]: 'courses' };
    const reflector = makeReflector(metadata);
    const interceptor = new HttpCacheInterceptor(cacheService, reflector);
    const [ctx] = makeContext({ metadata });

    // Should resolve without throwing
    const obs = await interceptor.intercept(ctx, makeHandler('data'));
    await expect(lastValueFrom(obs)).resolves.toBe('data');
    expect(failingSet).toHaveBeenCalled();
  });

  it('calls invalidateNamespace when a non-GET handler is decorated with @InvalidatesCache', async () => {
    const invalidate = jest.fn().mockResolvedValue(undefined);
    const cacheService = {
      buildKey: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      invalidateNamespace: invalidate,
    } as unknown as CacheService;

    const metadata = { [CACHE_INVALIDATE_KEY]: ['courses'] };
    const reflector = makeReflector(metadata);
    const interceptor = new HttpCacheInterceptor(cacheService, reflector);
    const [ctx] = makeContext({ method: 'POST', metadata });

    const obs = await interceptor.intercept(ctx, makeHandler({ id: '1' }));
    await lastValueFrom(obs);

    expect(invalidate).toHaveBeenCalledWith('courses');
  });
});
