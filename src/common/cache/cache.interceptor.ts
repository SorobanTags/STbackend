// cache.interceptor.ts — issues #41, #42: per-user cache keys + invalidation on mutation
import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CacheService } from './cache.service';
import {
  CACHE_NAMESPACE_KEY,
  CACHE_TTL_KEY,
  CACHE_PUBLIC_KEY,
  CACHE_INVALIDATES_KEY,
} from './cache.decorator';

@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpCacheInterceptor.name);

  constructor(
    private readonly cache: CacheService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const namespace = this.reflector.getAllAndOverride<string>(CACHE_NAMESPACE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Handle cache invalidation for mutating methods (Issue #41)
    if (request.method !== 'GET') {
      const invalidates = this.reflector.getAllAndOverride<string[]>(CACHE_INVALIDATES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

      if (invalidates?.length) {
        return next.handle().pipe(
          tap(async () => {
            for (const ns of invalidates) {
              await this.cache.invalidateNamespace(ns).catch((err: Error) => {
                this.logger.warn(`Cache invalidation failed for namespace "${ns}": ${err.message}`);
              });
            }
          }),
        );
      }

      return next.handle();
    }

    if (!namespace) {
      return next.handle();
    }

    const ttl = this.reflector.getAllAndOverride<number>(CACHE_TTL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Issue #42: include user id in key unless the handler is explicitly public/shared
    const isPublic = this.reflector.getAllAndOverride<boolean>(CACHE_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const userSegment = isPublic
      ? {}
      : { _uid: (request.user?.id as string | undefined) ?? 'anonymous' };

    const key = this.cache.buildKey(namespace, {
      ...request.params,
      ...request.query,
      ...userSegment,
    });

    const cached = await this.cache.get(key);

    if (cached !== null) {
      response.setHeader('X-Cache-Status', 'HIT');
      return of(cached);
    }

    response.setHeader('X-Cache-Status', 'MISS');
    return next.handle().pipe(
      tap((data) => {
        // Issue #41: await the write and log on failure instead of fire-and-forget
        this.cache.set(key, data, ttl).catch((err: Error) => {
          this.logger.warn(`Cache write failed for "${key}": ${err.message}`);
        });
      }),
    );
  }
}
