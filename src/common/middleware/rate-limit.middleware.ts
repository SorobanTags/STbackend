// rate-limit.middleware.ts
// Issue #71 — global request rate limiting (per-IP fixed window),
// with stricter budgets for sensitive routes and an exemption list
// for trusted services (e.g. health probes, internal callers).
import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';

/** Route prefixes whose abuse surface warrants a much tighter budget. */
const SENSITIVE_PREFIXES = ['/api/v1/auth'];

/** Paths never counted against rate limits (health checks, API docs). */
const EXEMPT_PREFIXES = ['/api/v1/health', '/docs', '/docs-json'];

interface Bucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimitMiddleware.name);
  private readonly buckets = new Map<string, Bucket>();

  private readonly windowMs: number;
  private readonly standardMax: number;
  private readonly sensitiveMax: number;
  private readonly exemptIps: Set<string>;
  private readonly maxBuckets: number;
  private lastPruneAt = 0;

  constructor(private readonly config: ConfigService) {
    this.windowMs = this.config.get<number>('RATE_LIMIT_WINDOW_MS', 60000);
    this.standardMax = this.config.get<number>('RATE_LIMIT_STANDARD_MAX', 100);
    this.sensitiveMax = this.config.get<number>('RATE_LIMIT_SENSITIVE_MAX', 10);

    const exemptList =
      this.config.get<string>('RATE_LIMIT_EXEMPT_IPS', '') ?? '';
    this.exemptIps = new Set(
      exemptList.split(',').map((ip) => ip.trim()).filter(Boolean),
    );
    this.maxBuckets = this.config.get<number>('RATE_LIMIT_MAX_BUCKETS', 10_000);
    if (this.exemptIps.size > 0) {
      this.logger.log(`Rate-limit exemption list loaded (${this.exemptIps.size} IPs)`);
    }
  }

  use(req: Request, res: Response, next: NextFunction) {
    const path = req.originalUrl.split('?')[0];

    if (
      EXEMPT_PREFIXES.some((p) => path.startsWith(p)) ||
      this.exemptIps.has(req.ip ?? '')
    ) {
      return next();
    }

    const sensitive = SENSITIVE_PREFIXES.some((p) => path.startsWith(p));
    const max = sensitive ? this.sensitiveMax : this.standardMax;

    const key = `${req.ip}:${sensitive ? 'sensitive' : 'standard'}`;
    const now = Date.now();

    this.pruneExpired(now);

    let bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader('Retry-After', retryAfterSeconds);
      this.logger.warn(
        `Rate limit exceeded: ip=${req.ip} path=${path} ` +
        `${bucket.count}/${max} in window`,
      );
      return res.status(429).json({
        success: false,
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'You have exceeded the request rate limit. Please slow down.',
        retryAfterSeconds,
      });
    }

    next();
  }

  private pruneExpired(now: number) {
    if (now - this.lastPruneAt < this.windowMs && this.buckets.size < this.maxBuckets) return;
    this.lastPruneAt = now;
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
    if (this.buckets.size > this.maxBuckets) {
      const sorted = [...this.buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
      const toEvict = sorted.slice(0, this.buckets.size - this.maxBuckets);
      for (const [key] of toEvict) this.buckets.delete(key);
    }
  }
}
