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
    expect(service.getStats()).toMatchObject({ hits: 1, misses: 0 });
  });

  it('returns null for a missing key and tracks cache misses', async () => {
    mockRedis.get.mockResolvedValue(null);

    await expect(service.get('cache:courses:missing')).resolves.toBeNull();
    expect(service.getStats()).toMatchObject({ hits: 0, misses: 1 });
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
});
