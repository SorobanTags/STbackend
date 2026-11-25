import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './cache.constants';

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
      this.misses += 1;
      this.logger.warn(`Cache read failed for key ${key}: ${(error as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    try {
      const payload = JSON.stringify(value);
      if (ttlSeconds && ttlSeconds > 0) {
        await this.redis.set(key, payload, 'EX', ttlSeconds);
      } else {
        await this.redis.set(key, payload);
      }
    } catch (error) {
      this.logger.warn(`Cache write failed for key ${key}: ${(error as Error).message}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.warn(`Cache delete failed for key ${key}: ${(error as Error).message}`);
    }
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

  /**
   * Resets the in-process hit/miss counters to zero.
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }
}
