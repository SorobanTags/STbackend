import { ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service';

const mockRedis = {
  on: jest.fn(),
  quit: jest.fn(),
  ping: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  scan: jest.fn(),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockRedis),
}));

describe('CacheService', () => {
  let service: CacheService;
  const mockConfigGet = jest.fn((key: string, defaultValue?: unknown) => defaultValue);
  const config = { get: mockConfigGet } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.on.mockReturnThis();
    mockRedis.quit.mockResolvedValue('OK');
    mockRedis.get.mockReset();
    mockRedis.set.mockReset().mockResolvedValue('OK');
    mockRedis.del.mockReset().mockResolvedValue(1);
    mockRedis.scan.mockReset();
    mockConfigGet.mockImplementation((key: string, defaultValue?: unknown) =>
      key === 'CACHE_TTL_SECONDS' ? 45 : defaultValue,
    );
    service = new CacheService(config);
  });

  it('builds stable namespaced keys from query parameters', () => {
    expect(service.buildKey('courses', { page: 2, empty: '', category: 'math' }))
      .toBe('cache:courses:category=math&page=2');
  });

  it('returns parsed values from the Redis store and tracks cache hits', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify({ id: 'course-1' }));

    await expect(service.get('cache:courses:1')).resolves.toEqual({ id: 'course-1' });
    expect(mockRedis.get).toHaveBeenCalledWith('cache:courses:1');
    expect(service.getStats()).toMatchObject({ hits: 1, misses: 0, scope: 'instance' });
  });

  it('returns null for a missing key and tracks cache misses', async () => {
    mockRedis.get.mockResolvedValue(null);

    await expect(service.get('cache:courses:missing')).resolves.toBeNull();
    expect(service.getStats()).toMatchObject({ hits: 0, misses: 1, scope: 'instance' });
  });

  it('counts a Redis read error as a miss', async () => {
    mockRedis.get.mockRejectedValue(new Error('connection lost'));

    const value = await service.get('cache:courses:error');

    expect(value).toBeNull();
    expect(service.getStats()).toMatchObject({ hits: 0, misses: 1, scope: 'instance' });
  });

  it('resetStats() zeroes both counters', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify('value'));
    mockRedis.get.mockResolvedValueOnce(null);

    await service.get('cache:courses:hit');
    await service.get('cache:courses:miss');
    expect(service.getStats()).toMatchObject({ hits: 1, misses: 1 });

    service.resetStats();

    expect(service.getStats()).toEqual({ hits: 0, misses: 0, hitRate: 0, scope: 'instance' });
  });

  it('serializes values and uses the configured default TTL', async () => {
    const value = { id: 'course-1' };

    await service.set('cache:courses:1', value);

    expect(mockRedis.set).toHaveBeenCalledWith(
      'cache:courses:1',
      JSON.stringify(value),
      'EX',
      45,
    );
  });

  it('delegates key deletion to Redis', async () => {
    await service.del('cache:courses:1');

    expect(mockRedis.del).toHaveBeenCalledWith('cache:courses:1');
  });

  it('deletes matching keys while scanning a namespace', async () => {
    mockRedis.scan
      .mockResolvedValueOnce(['7', ['cache:courses:1']])
      .mockResolvedValueOnce(['0', ['cache:courses:2']]);

    await service.invalidateNamespace('courses');

    expect(mockRedis.scan).toHaveBeenNthCalledWith(
      1,
      '0',
      'MATCH',
      'cache:courses*',
      'COUNT',
      100,
    );
    expect(mockRedis.del).toHaveBeenNthCalledWith(1, 'cache:courses:1');
    expect(mockRedis.del).toHaveBeenNthCalledWith(2, 'cache:courses:2');
  });

  describe('CacheService.invalidateNamespace', () => {
    let redis: {
      scan: jest.Mock;
      del: jest.Mock;
    };
    let config: { get: jest.Mock };
    let service: CacheService;

    beforeEach(() => {
      redis = {
        scan: jest.fn(),
        del: jest.fn().mockResolvedValue(1),
      };
      config = {
        get: jest.fn().mockReturnValue(undefined),
      };
      service = new CacheService(redis as any, config as unknown as ConfigService);
      (service as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    });

    it('fully invalidates a namespace under the cap', async () => {
      redis.scan
        .mockResolvedValueOnce(['1', ['cache:ns:a', 'cache:ns:b']])
        .mockResolvedValueOnce(['0', ['cache:ns:c']]);

      await service.invalidateNamespace('ns');

      expect(redis.scan).toHaveBeenCalledTimes(2);
      expect(redis.del).toHaveBeenCalledTimes(2);
      expect(redis.del).toHaveBeenNthCalledWith(1, 'cache:ns:a', 'cache:ns:b');
      expect(redis.del).toHaveBeenNthCalledWith(2, 'cache:ns:c');
      expect((service as any).logger.warn).not.toHaveBeenCalled();
    });

    it('stops early and warns when the max-keys cap is reached', async () => {
      redis.scan
        .mockResolvedValueOnce(['1', ['cache:ns:a', 'cache:ns:b']])
        .mockResolvedValueOnce(['2', ['cache:ns:c', 'cache:ns:d']])
        .mockResolvedValueOnce(['0', ['cache:ns:e']]);

      await service.invalidateNamespace('ns', { maxKeys: 3 });

      expect(redis.scan).toHaveBeenCalledTimes(2);
      expect(redis.del).toHaveBeenCalledTimes(2);
      expect((service as any).logger.warn).toHaveBeenCalledTimes(1);
      const warnMessage = (service as any).logger.warn.mock.calls[0][0];
      expect(warnMessage).toContain('ns');
      expect(warnMessage).toContain('4');
    });

    it('logs a warning with the deleted count when Redis errors during SCAN', async () => {
      redis.scan.mockRejectedValueOnce(new Error('redis down'));

      await expect(service.invalidateNamespace('ns')).rejects.toThrow('redis down');

      expect((service as any).logger.warn).toHaveBeenCalledTimes(1);
      const warnMessage = (service as any).logger.warn.mock.calls[0][0];
      expect(warnMessage).toContain('ns');
      expect(warnMessage).toContain('0');
    });
  });
  });
});
