// cache.decorator.ts — issue #92: marks a GET route handler as cache-eligible
import { SetMetadata } from '@nestjs/common';

export const CACHE_NAMESPACE_KEY = 'cache:namespace';
export const CACHE_TTL_KEY = 'cache:ttl';
export const CACHE_PUBLIC_KEY = 'cache:public';
export const CACHE_INVALIDATES_KEY = 'cache:invalidates';

/** Marks a route as eligible for response caching under the given namespace.
 *  Set `options.public` to true for responses that are identical for all users
 *  (i.e. do not vary by authenticated user). Without this flag the interceptor
 *  includes the authenticated user's id in the cache key so responses cannot
 *  leak between users (Issue #42).
 */
export const Cacheable = (
  namespace: string,
  ttlSeconds?: number,
  options?: { public?: boolean },
) =>
  (target: any, key?: string, descriptor?: any) => {
    SetMetadata(CACHE_NAMESPACE_KEY, namespace)(target, key, descriptor);
    if (ttlSeconds !== undefined) {
      SetMetadata(CACHE_TTL_KEY, ttlSeconds)(target, key, descriptor);
    }
    if (options?.public) {
      SetMetadata(CACHE_PUBLIC_KEY, true)(target, key, descriptor);
    }
    return descriptor;
  };

/**
 * Marks a mutating (POST/PATCH/PUT/DELETE) route handler as one that should
 * invalidate the given cache namespace(s) on success (Issue #41).
 *
 * Usage:
 *   @InvalidatesCache('courses')
 *   @Patch(':id')
 *   update(...) { ... }
 */
export const InvalidatesCache = (...namespaces: string[]) =>
  SetMetadata(CACHE_INVALIDATES_KEY, namespaces);
