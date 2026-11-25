import { Test } from '@nestjs/testing';
import { CacheService } from './cache.service';
import { REDIS_CLIENT } from './cache.constants';

describe('CacheService', () => {
  let service: CacheService;
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    redis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    service = moduleRef.get(CacheService);
  });

  it('counts a hit when the key exists', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ ok: true }));

    const value = await service.get<{ ok: boolean }>('key');

    expect(value).toEqual({ ok: true });
    expect(service.getStats()).toMatchObject({ hits: 1, misses: 0, scope: 'instance' });
  });

  it('counts a miss when the key is absent', async () => {
    redis.get.mockResolvedValue(null);

    const value = await service.get('key');

    expect(value).toBeNull();
    expect(service.getStats()).toMatchObject({ hits: 0, misses: 1, scope: 'instance' });
  });

  it('counts a Redis read error as a miss', async () => {
    redis.get.mockRejectedValue(new Error('connection lost'));

    const value = await service.get('key');

    expect(value).toBeNull();
    expect(service.getStats()).toMatchObject({ hits: 0, misses: 1, scope: 'instance' });
  });

  it('resetStats() zeroes both counters', async () => {
    redis.get.mockResolvedValueOnce(JSON.stringify('value'));
    redis.get.mockResolvedValueOnce(null);

    await service.get('hit');
    await service.get('miss');
    expect(service.getStats()).toMatchObject({ hits: 1, misses: 1 });

    service.resetStats();

    expect(service.getStats()).toEqual({ hits: 0, misses: 0, hitRate: 0, scope: 'instance' });
  });
});
