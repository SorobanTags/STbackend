import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Cache } from 'cache-manager';
import { REDIS_CLIENT } from './cache.constants';

const DEFAULT_INVALIDATE_MAX_KEYS = 10_000;
const SCAN_BATCH_SIZE = 100;

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  /**
   * Scope of the reported numbers. `instance` means the counters are
   * process-local and reset on restart; `cluster` means they are shared
   * across replicas via Redis.
   */
  scope: 'instance' | 'cluster';
}

export interface InvalidateNamespaceOptions {
  maxKeys?: number;
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private hits = 0;
  private misses = 0;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      if (value === null || value === undefined) {
        this.misses += 1;
        return null;
      }
      this.hits += 1;
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error(`Failed to get cache key ${key}`, error as Error);
      throw error;
    }
  }
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly cache: Cache,
    private readonly configService: ConfigService,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const value = await this.cache.get<T>(key);
      if (value === null || value === undefined) {
        this.misses += 1;
        return undefined;
      }
      this.hits += 1;
      return value;
    } catch (error) {
      this.misses += 1;
      this.logger.warn(`Cache read failed for key ${key}: ${(error as Error).message}`);
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    try {
      await this.cache.set(key, value, ttlMs);
    } catch (error) {
      this.logger.warn(`Cache write failed for key ${key}: ${(error as Error).message}`);
    }
  }

  /**
   * Atomically increments a counter and applies a TTL on first creation.
   * Used by rate limiters (e.g. OTP throttling) so the window is shared
   * across instances and expires automatically instead of leaking memory.
   * Returns the post-increment count and the remaining TTL in seconds.
   */
  async increment(key: string, ttlSeconds: number): Promise<{ count: number; ttlSeconds: number }> {
    try {
      const results = await this.redis
        .multi()
        .incr(key)
        .ttl(key)
        .exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      let ttl = Number(results?.[1]?.[1] ?? -1);
      if (ttl < 0) {
        await this.redis.expire(key, ttlSeconds);
        ttl = ttlSeconds;
      }
      return { count, ttlSeconds: ttl };
    } catch (err) {
      this.logger.warn(`Cache increment failed for "${key}": ${(err as Error).message}`);
      return { count: 0, ttlSeconds };
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.cache.del(key);
    } catch (error) {
      this.logger.warn(`Cache delete failed for key ${key}: ${(error as Error).message}`);
    }
  }

  private resolveMaxKeys(options?: InvalidateNamespaceOptions): number {
    if (options?.maxKeys !== undefined) {
      return options.maxKeys;
    }
    const configured = this.configService?.get<string | number>(
      'CACHE_INVALIDATE_MAX_KEYS',
    );
    const parsed = Number(configured);
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_INVALIDATE_MAX_KEYS;
  }

  /**
   * Returns cache hit/miss statistics.
   *
   * The counters are kept in-process and are therefore scoped to this
   * instance (`scope: 'instance'`). They reset on restart and are not
   * aggregated across replicas. Use `resetStats()` to zero them.
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
      scope: 'instance',
    };
  }

  async invalidateNamespace(
    namespace: string,
    options?: InvalidateNamespaceOptions,
  ): Promise<number> {
    const maxKeys = this.resolveMaxKeys(options);
    const pattern = `${namespace}:*`;
    let deleted = 0;
    let cursor = '0';

    try {
      do {
        const [nextCursor, keys] = await this.cache.store.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          SCAN_BATCH_SIZE,
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          const remaining = maxKeys - deleted;
          const batch = keys.slice(0, remaining);
          if (batch.length > 0) {
            await this.cache.store.del(...batch);
            deleted += batch.length;
          }
        }

        if (deleted >= maxKeys) {
          this.logger.warn(
            `invalidateNamespace(${namespace}) reached maxKeys cap (${maxKeys}); deleted ${deleted} keys, namespace may be partially invalidated`,
          );
          break;
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn(
        `invalidateNamespace(${namespace}) failed after deleting ${deleted} keys: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }

    return deleted;
  }
  }

  /**
   * Resets the in-process hit/miss counters to zero.
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }
}
