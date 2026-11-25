import { configuredDatabaseUrl } from './prisma.service';

describe('configuredDatabaseUrl', () => {
  const originalConnectionLimit = process.env.PRISMA_CONNECTION_LIMIT;
  const originalPoolTimeout = process.env.PRISMA_POOL_TIMEOUT_SECONDS;

  beforeEach(() => {
    delete process.env.PRISMA_CONNECTION_LIMIT;
    delete process.env.PRISMA_POOL_TIMEOUT_SECONDS;
  });

  afterAll(() => {
    if (originalConnectionLimit === undefined) {
      delete process.env.PRISMA_CONNECTION_LIMIT;
    } else {
      process.env.PRISMA_CONNECTION_LIMIT = originalConnectionLimit;
    }
    if (originalPoolTimeout === undefined) {
      delete process.env.PRISMA_POOL_TIMEOUT_SECONDS;
    } else {
      process.env.PRISMA_POOL_TIMEOUT_SECONDS = originalPoolTimeout;
    }
  });

  it('returns undefined when no database URL is provided', () => {
    expect(configuredDatabaseUrl(undefined)).toBeUndefined();
  });

  it('adds default connection pool parameters when absent', () => {
    const result = new URL(
      configuredDatabaseUrl('postgresql://user:pass@localhost:5432/db')!,
    );

    expect(result.searchParams.get('connection_limit')).toBe('10');
    expect(result.searchParams.get('pool_timeout')).toBe('10');
  });

  it('applies explicit connection pool environment values', () => {
    process.env.PRISMA_CONNECTION_LIMIT = '25';
    process.env.PRISMA_POOL_TIMEOUT_SECONDS = '45';

    const result = new URL(
      configuredDatabaseUrl('postgresql://user:pass@localhost:5432/db')!,
    );

    expect(result.searchParams.get('connection_limit')).toBe('25');
    expect(result.searchParams.get('pool_timeout')).toBe('45');
  });

  it('preserves connection pool parameters already in the URL', () => {
    process.env.PRISMA_CONNECTION_LIMIT = '25';
    process.env.PRISMA_POOL_TIMEOUT_SECONDS = '45';

    const result = new URL(
      configuredDatabaseUrl(
        'postgresql://user:pass@localhost:5432/db?connection_limit=4&pool_timeout=6',
      )!,
    );

    expect(result.searchParams.get('connection_limit')).toBe('4');
    expect(result.searchParams.get('pool_timeout')).toBe('6');
  });

  it.each(['0', '1001', '1.5', 'abc'])(
    'rejects PRISMA_CONNECTION_LIMIT=%s and states its accepted range',
    (value) => {
      process.env.PRISMA_CONNECTION_LIMIT = value;

      expect(() =>
        configuredDatabaseUrl('postgresql://user:pass@localhost:5432/db'),
      ).toThrow('PRISMA_CONNECTION_LIMIT: must be an integer between 1 and 1000');
    },
  );

  it.each(['0', '301', '1.5', 'abc'])(
    'rejects PRISMA_POOL_TIMEOUT_SECONDS=%s and states its accepted range',
    (value) => {
      process.env.PRISMA_POOL_TIMEOUT_SECONDS = value;

      expect(() =>
        configuredDatabaseUrl('postgresql://user:pass@localhost:5432/db'),
      ).toThrow(
        'PRISMA_POOL_TIMEOUT_SECONDS: must be an integer between 1 and 300',
      );
    },
  );

  it('reports malformed database URLs with the environment variable name', () => {
    expect(() => configuredDatabaseUrl('not-a-url')).toThrow('DATABASE_URL');
  });
});
