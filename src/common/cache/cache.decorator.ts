// cache.decorator.ts — issue #92: marks a GET route handler as cache-eligible
import { SetMetadata } from '@nestjs/common';

export const CACHE_NAMESPACE_KEY = 'cache:namespace';
export const CACHE_TTL_KEY = 'cache:ttl';
export const CACHE_PUBLIC_KEY = 'cache:public';
export const CACHE_INVALIDATE_KEY = 'cache:invalidate';

export interface CacheableOptions {
  /**
   * When true the cache key is built without the authenticated user id,
   * making the response shareable across all users (issue #42).
   */
  public?: boolean;
  /** TTL in seconds; falls back to the application default when omitted. */
  ttlSeconds?: number;
}

/** Marks a route as eligible for response caching under the given namespace. */
export const Cacheable = (namespace: string, options?: CacheableOptions | number) =>
  (target: any, key?: string, descriptor?: any) => {
    SetMetadata(CACHE_NAMESPACE_KEY, namespace)(target, key, descriptor);

    if (typeof options === 'number') {
      // backward-compat: Cacheable('ns', 60)
      SetMetadata(CACHE_TTL_KEY, options)(target, key, descriptor);
    } else if (options) {
      if (options.ttlSeconds !== undefined) {
        SetMetadata(CACHE_TTL_KEY, options.ttlSeconds)(target, key, descriptor);
      }
      if (options.public) {
        SetMetadata(CACHE_PUBLIC_KEY, true)(target, key, descriptor);
      }
    }

    return descriptor;
  };

/**
 * Causes the interceptor to call `CacheService.invalidateNamespace` with the
 * supplied namespace(s) after any non-GET handler returns successfully (issue #41).
 *
 * Usage:
 *   @Post()
 *   @InvalidatesCache('courses')
 *   create(@Body() dto: CreateCourseDto) { … }
 */
export const InvalidatesCache = (...namespaces: string[]) =>
  SetMetadata(CACHE_INVALIDATE_KEY, namespaces);
