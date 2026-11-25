import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisConnectionProvider } from './queue.module';

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    quit: jest.fn().mockResolvedValue('OK'),
  }));
});

const MockedRedis = Redis as unknown as jest.Mock;

describe('RedisConnectionProvider', () => {
  beforeEach(() => {
    MockedRedis.mockClear();
  });

  it('creates a client when REDIS_URL is set', () => {
    const configService = {
      get: jest.fn((key: string) => (key === 'REDIS_URL' ? 'redis://localhost:6379' : undefined)),
    } as unknown as ConfigService;

    const provider = new RedisConnectionProvider(configService);

    expect(MockedRedis).toHaveBeenCalledWith('redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
    expect(provider.getClient()).not.toBeNull();
  });

  it('does not create a client when REDIS_URL is unset', () => {
    const configService = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;

    const provider = new RedisConnectionProvider(configService);

    expect(MockedRedis).not.toHaveBeenCalled();
    expect(provider.getClient()).toBeNull();
  });

  it('quits the client on application shutdown', async () => {
    const configService = {
      get: jest.fn((key: string) => (key === 'REDIS_URL' ? 'redis://localhost:6379' : undefined)),
    } as unknown as ConfigService;

    const provider = new RedisConnectionProvider(configService);
    const client = provider.getClient() as unknown as { quit: jest.Mock };

    await provider.onApplicationShutdown();

    expect(client.quit).toHaveBeenCalledTimes(1);
  });

  it('does not throw on shutdown when no client was created', async () => {
    const configService = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;

    const provider = new RedisConnectionProvider(configService);

    await expect(provider.onApplicationShutdown()).resolves.toBeUndefined();
  });
});
