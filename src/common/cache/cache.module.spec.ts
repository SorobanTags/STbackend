import { ConfigService } from '@nestjs/config';
import { buildCacheOptions } from './cache.module';

describe('CacheModule options factory', () => {
  const createConfigService = (values: Record<string, string | undefined>) =>
    ({
      get: (key: string) => values[key],
    }) as unknown as ConfigService;

  it('returns Redis store options when REDIS_URL is set', async () => {
    const configService = createConfigService({
      REDIS_URL: 'redis://localhost:6379',
      CACHE_TTL_MS: '30000',
    });

    const options = await buildCacheOptions(configService);

    expect(options.store).toBeDefined();
    expect(options.ttl).toBe(30000);
  });

  it('returns Redis store options when REDIS_HOST is set', async () => {
    const configService = createConfigService({
      REDIS_HOST: 'localhost',
      REDIS_PORT: '6380',
      REDIS_PASSWORD: 'secret',
    });

    const options = await buildCacheOptions(configService);

    expect(options.store).toBeDefined();
    expect(options.ttl).toBe(60000);
  });

  it('falls back to the in-memory store when no Redis env vars are set', async () => {
    const configService = createConfigService({});

    const options = await buildCacheOptions(configService);

    expect(options.store).toBeUndefined();
    expect(options.ttl).toBe(60000);
  });
});
