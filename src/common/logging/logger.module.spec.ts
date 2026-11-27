import { Response } from 'express';
import { correlationIdStorage, CorrelationIdMiddleware, getCorrelationId } from './logger.module';

describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;

  beforeEach(() => {
    middleware = new CorrelationIdMiddleware();
  });

  it('populates the store with req.id so getCorrelationId() returns it inside the handler', (done) => {
    const req = { id: 'test-req-id-123', headers: {} } as any;
    const res = {} as Response;

    middleware.use(req, res, () => {
      expect(getCorrelationId()).toBe('test-req-id-123');
      done();
    });
  });

  it('falls back to the x-correlation-id header when req.id is absent', (done) => {
    const req = { headers: { 'x-correlation-id': 'header-id-456' } } as any;
    const res = {} as Response;

    middleware.use(req, res, () => {
      expect(getCorrelationId()).toBe('header-id-456');
      done();
    });
  });

  it('generates a UUID when neither req.id nor the header is present', (done) => {
    const req = { headers: {} } as any;
    const res = {} as Response;

    middleware.use(req, res, () => {
      const id = getCorrelationId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      done();
    });
  });

  it('prefers req.id over the x-correlation-id header', (done) => {
    const req = { id: 'pino-id', headers: { 'x-correlation-id': 'header-id' } } as any;
    const res = {} as Response;

    middleware.use(req, res, () => {
      expect(getCorrelationId()).toBe('pino-id');
      done();
    });
  });

  it('returns undefined outside a request context', () => {
    // No correlationIdStorage.run() wrapping this call — store is empty.
    expect(getCorrelationId()).toBeUndefined();
  });

  it('isolates correlation IDs across concurrent async contexts', async () => {
    const results: Array<string | undefined> = [];

    const run = (id: string) =>
      new Promise<void>((resolve) => {
        const req = { id, headers: {} } as any;
        middleware.use(req, {} as Response, () => {
          // Yield to let the other context run before reading the store.
          setImmediate(() => {
            results.push(getCorrelationId());
            resolve();
          });
        });
      });

    await Promise.all([run('context-A'), run('context-B')]);

    expect(results).toHaveLength(2);
    expect(results).toContain('context-A');
    expect(results).toContain('context-B');
    // Each context must have seen its own ID, not the other's.
    expect(results[0]).not.toBe(results[1]);
  });
});

describe('getCorrelationId outside any request', () => {
  it('returns undefined when called at module load time', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('returns undefined after a request context exits', (done) => {
    const middleware = new CorrelationIdMiddleware();
    const req = { id: 'ephemeral-id', headers: {} } as any;

    middleware.use(req, {} as Response, () => {
      expect(getCorrelationId()).toBe('ephemeral-id');
      done();
    });

    // Outside the callback the store is gone — this assertion runs synchronously
    // before the next() callback, confirming the store is scoped to the run().
    expect(getCorrelationId()).toBeUndefined();
  });
});
