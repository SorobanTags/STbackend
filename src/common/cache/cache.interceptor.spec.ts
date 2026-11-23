import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, lastValueFrom } from 'rxjs';
import { HttpCacheInterceptor } from './cache.interceptor';
import { CacheService } from './cache.service';
import {
  CACHE_NAMESPACE_KEY,
  CACHE_PUBLIC_KEY,
  CACHE_INVALIDATES_KEY,
} from './cache.decorator';

function makeContext(overrides: {
  method?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  user?: { id: string } | null;
  handler?: object;
}): ExecutionContext {
  const req = {
    method: overrides.method ?? 'GET',
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    user: overrides.user ?? undefined,
  };
  const res = { setHeader: jest.fn() };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
    getHandler: () => overrides.handler ?? {},
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function makeHandler(observable = of({ ok: true })): CallHandler {
  return { handle: () => observable };
}

function makeReflector(values: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: (_key: string, _targets: unknown[]) => values[_key],
  } as unknown as Reflector;
}

function makeCacheService(cachedValue: unknown = null) {
  return {
    buildKey: jest.fn((ns: string, params: Record<string, unknown>) => {
      const parts = Object.entries(params)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
      return `cache:${ns}${parts ? ':' + parts : ''}`;
    }),
    get: jest.fn().mockResolvedValue(cachedValue),
    set: jest.fn().mockResolvedValue(undefined),
    invalidateNamespace: jest.fn().mockResolvedValue(undefined),
  } as unknown as CacheService;
}

describe('HttpCacheInterceptor (Issues #41, #42)', () => {
  describe('Issue #42 — per-user cache keys', () => {
    it('produces distinct keys for two requests with different user ids', async () => {
      const cacheService = makeCacheService(null);
      const reflector = makeReflector({
        [CACHE_NAMESPACE_KEY]: 'courses',
        [CACHE_PUBLIC_KEY]: undefined,
      });
      const interceptor = new HttpCacheInterceptor(cacheService, reflector);

      const ctxUser1 = makeContext({ user: { id: 'user-1' } });
      const ctxUser2 = makeContext({ user: { id: 'user-2' } });

      await interceptor.intercept(ctxUser1, makeHandler());
      await interceptor.intercept(ctxUser2, makeHandler());

      const keys = (cacheService.buildKey as jest.Mock).mock.results.map((r) => r.value as string);
      expect(keys[0]).not.toBe(keys[1]);
    });

    it('both requests MISS when keys differ', async () => {
      const cacheService = makeCacheService(null);
      const reflector = makeReflector({
        [CACHE_NAMESPACE_KEY]: 'courses',
        [CACHE_PUBLIC_KEY]: undefined,
      });
      const interceptor = new HttpCacheInterceptor(cacheService, reflector);

      const res1 = { setHeader: jest.fn() };
      const res2 = { setHeader: jest.fn() };
      const ctx1 = makeContext({ user: { id: 'user-1' } });
      const ctx2 = makeContext({ user: { id: 'user-2' } });
      (ctx1.switchToHttp().getResponse as jest.Mock) = jest.fn().mockReturnValue(res1);
      (ctx2.switchToHttp().getResponse as jest.Mock) = jest.fn().mockReturnValue(res2);

      // Both get called and both trigger a set (since cache returns null)
      await interceptor.intercept(ctxUser1(cacheService), makeHandler());
      await interceptor.intercept(ctxUser2(cacheService), makeHandler());

      expect(cacheService.set).toHaveBeenCalledTimes(2);

      function ctxUser1(cs: CacheService) {
        return makeContext({ user: { id: 'user-1' } });
      }
      function ctxUser2(cs: CacheService) {
        return makeContext({ user: { id: 'user-2' } });
      }
    });

    it('a public handler produces the same key regardless of user', async () => {
      const cacheService = makeCacheService(null);
      const reflector = makeReflector({
        [CACHE_NAMESPACE_KEY]: 'courses',
        [CACHE_PUBLIC_KEY]: true,
      });
      const interceptor = new HttpCacheInterceptor(cacheService, reflector);

      await interceptor.intercept(makeContext({ user: { id: 'user-1' } }), makeHandler());
      await interceptor.intercept(makeContext({ user: { id: 'user-2' } }), makeHandler());

      const keys = (cacheService.buildKey as jest.Mock).mock.results.map((r) => r.value as string);
      expect(keys[0]).toBe(keys[1]);
    });

    it('sets X-Cache-Status to MISS then HIT for repeated identical requests', async () => {
      let storedValue: unknown = null;
      const cacheService = {
        buildKey: (ns: string, params: Record<string, unknown>) => `cache:${ns}`,
        get: jest.fn().mockImplementation(() => Promise.resolve(storedValue)),
        set: jest.fn().mockImplementation((_key: string, value: unknown) => {
          storedValue = value;
          return Promise.resolve();
        }),
        invalidateNamespace: jest.fn(),
      } as unknown as CacheService;

      const reflector = makeReflector({
        [CACHE_NAMESPACE_KEY]: 'courses',
        [CACHE_PUBLIC_KEY]: true,
      });
      const interceptor = new HttpCacheInterceptor(cacheService, reflector);

      const res1 = { setHeader: jest.fn() };
      const res2 = { setHeader: jest.fn() };

      const ctx1 = {
        switchToHttp: () => ({ getRequest: () => ({ method: 'GET', params: {}, query: {}, user: undefined }), getResponse: () => res1 }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;

      const ctx2 = {
        switchToHttp: () => ({ getRequest: () => ({ method: 'GET', params: {}, query: {}, user: undefined }), getResponse: () => res2 }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;

      const obs1 = await interceptor.intercept(ctx1, makeHandler(of({ data: 'result' })));
      await lastValueFrom(obs1);

      const obs2 = await interceptor.intercept(ctx2, makeHandler(of({ data: 'result' })));
      await lastValueFrom(obs2);

      expect(res1.setHeader).toHaveBeenCalledWith('X-Cache-Status', 'MISS');
      expect(res2.setHeader).toHaveBeenCalledWith('X-Cache-Status', 'HIT');
    });
  });

  describe('Issue #41 — cache write failures and invalidation', () => {
    it('does not produce an unhandled rejection when cache.set rejects', async () => {
      const cacheService = makeCacheService(null);
      (cacheService.set as jest.Mock).mockRejectedValue(new Error('Redis down'));

      const reflector = makeReflector({
        [CACHE_NAMESPACE_KEY]: 'courses',
        [CACHE_PUBLIC_KEY]: true,
      });
      const interceptor = new HttpCacheInterceptor(cacheService, reflector);
      const ctx = makeContext({});

      const obs = await interceptor.intercept(ctx, makeHandler(of({ data: 'x' })));
      // Should resolve without throwing
      await expect(lastValueFrom(obs)).resolves.toBeDefined();
    });

    it('calls invalidateNamespace with the declared namespace on a mutating request', async () => {
      const cacheService = makeCacheService(null);
      const handler = {};
      const reflector = makeReflector({
        [CACHE_INVALIDATES_KEY]: ['courses'],
      });
      const interceptor = new HttpCacheInterceptor(cacheService, reflector);
      const ctx = makeContext({ method: 'POST', handler });

      const obs = await interceptor.intercept(ctx, makeHandler(of({ id: '1' })));
      await lastValueFrom(obs);

      expect(cacheService.invalidateNamespace).toHaveBeenCalledWith('courses');
    });
  });
});
