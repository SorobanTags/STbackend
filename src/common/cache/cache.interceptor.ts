// cache.interceptor.ts — issue #92: read/write caching + X-Cache-Status header
// issue #41: await cache writes / log failures; invalidate on mutation
// issue #42: include user id in cache key for non-public endpoints
import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CacheService } from './cache.service';
import {
  CACHE_NAMESPACE_KEY,
  CACHE_TTL_KEY,
  CACHE_PUBLIC_KEY,
  CACHE_INVALIDATE_KEY,
} from './cache.decorator';

@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpCacheInterceptor.name);

  constructor(
    private readonly cache: CacheService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // ── Mutation path: invalidate declared namespaces after the handler returns ──
    if (request.method !== 'GET') {
      const namespaces = this.reflector.getAllAndOverride<string[]>(CACHE_INVALIDATE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

      if (namespaces?.length) {
        return next.handle().pipe(
          tap(() => {
            // Fire invalidations in the background; errors are logged by CacheService.
            for (const ns of namespaces) {
              void this.cache.invalidateNamespace(ns);
            }
          }),
        );
      }

      return next.handle();
    }

    // ── GET path: serve from cache when available ──────────────────────────────
    const namespace = this.reflector.getAllAndOverride<string>(CACHE_NAMESPACE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!namespace) {
      return next.handle();
    }

    const ttl = this.reflector.getAllAndOverride<number>(CACHE_TTL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const isPublic = this.reflector.getAllAndOverride<boolean>(CACHE_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? false;

    // issue #42: vary the key on user identity unless the endpoint is public.
    const userId: string = isPublic
      ? 'anonymous'
      : (request.user?.id as string | undefined) ?? 'anonymous';

    const key = this.cache.buildKey(namespace, {
      ...request.params,
      ...request.query,
      _uid: userId,
    });

    const cached = await this.cache.get(key);

    if (cached !== null) {
      response.setHeader('X-Cache-Status', 'HIT');
      return of(cached);
    }

    response.setHeader('X-Cache-Status', 'MISS');
    return next.handle().pipe(
      tap(async (data) => {
        // issue #41: await the write so errors surface through CacheService's
        // internal logger rather than becoming unhandled promise rejections.
        try {
          await this.cache.set(key, data, ttl);
        } catch (err) {
          this.logger.warn(`Cache write failed for "${key}": ${(err as Error).message}`);
        }
      }),
    );
  }
}
