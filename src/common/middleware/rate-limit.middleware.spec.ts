import { RateLimitMiddleware } from './rate-limit.middleware';

function makeMiddleware(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    RATE_LIMIT_WINDOW_MS: 60000,
    RATE_LIMIT_STANDARD_MAX: 5,
    RATE_LIMIT_SENSITIVE_MAX: 2,
    RATE_LIMIT_EXEMPT_IPS: '',
    RATE_LIMIT_MAX_BUCKETS: 100,
  };
  const config = { get: jest.fn((key: string, def: unknown) => overrides[key] ?? defaults[key] ?? def) };
  return new RateLimitMiddleware(config as any);
}

function makeReqRes(ip = '1.2.3.4', path = '/api/v1/data') {
  const headers: Record<string, unknown> = {};
  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn((k: string, v: unknown) => { headers[k] = v; }),
    _headers: headers,
  };
  const req: any = { ip, originalUrl: path };
  const next = jest.fn();
  return { req, res, next };
}

describe('RateLimitMiddleware', () => {
  let now: number;

  beforeEach(() => {
    now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
  });

  afterEach(() => jest.restoreAllMocks());

  it('allows requests under the limit and sets rate-limit headers', () => {
    const mw = makeMiddleware();
    const { req, res, next } = makeReqRes();
    mw.use(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 5);
  });

  it('returns 429 when limit is exceeded', () => {
    const mw = makeMiddleware({ RATE_LIMIT_STANDARD_MAX: 2 });
    const { req, res, next } = makeReqRes();
    mw.use(req, res, next); // 1
    mw.use(req, res, next); // 2
    mw.use(req, res, next); // 3 — over limit
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 429 }));
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });

  it('evicts expired buckets after windowMs elapses even without new keys', () => {
    const mw = makeMiddleware({ RATE_LIMIT_WINDOW_MS: 1000, RATE_LIMIT_MAX_BUCKETS: 100 });
    const { req: r1, res: res1, next: n1 } = makeReqRes('10.0.0.1');
    mw.use(r1, res1, n1);

    // Advance time past the window
    jest.spyOn(Date, 'now').mockReturnValue(now + 2000);

    const { req: r2, res: res2, next: n2 } = makeReqRes('10.0.0.2');
    mw.use(r2, res2, n2);

    // The old bucket for 10.0.0.1 should have been evicted
    const buckets = (mw as any).buckets as Map<string, unknown>;
    const hasOldKey = [...buckets.keys()].some((k) => k.startsWith('10.0.0.1'));
    expect(hasOldKey).toBe(false);
  });

  it('never exceeds RATE_LIMIT_MAX_BUCKETS when many distinct IPs are seen', () => {
    const mw = makeMiddleware({ RATE_LIMIT_MAX_BUCKETS: 10 });
    for (let i = 0; i < 20; i++) {
      const { req, res, next } = makeReqRes(`192.168.1.${i}`);
      mw.use(req, res, next);
    }
    const buckets = (mw as any).buckets as Map<string, unknown>;
    expect(buckets.size).toBeLessThanOrEqual(10);
  });
});
