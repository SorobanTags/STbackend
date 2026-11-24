import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { MeiliSearch } from 'meilisearch';
import { SearchService } from './search.service';

const mockSearch = jest.fn();
const mockFilterClean = jest.fn((query: string) => query);
const mockIndex = {
  search: mockSearch,
  getRawInfo: jest.fn(),
  updateSettings: jest.fn(),
};
const mockClient = {
  index: jest.fn().mockReturnValue(mockIndex),
  createIndex: jest.fn(),
  health: jest.fn(),
};

jest.mock('meilisearch', () => ({
  MeiliSearch: jest.fn().mockImplementation(() => mockClient),
}));

jest.mock('bad-words', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    clean: mockFilterClean,
  })),
}));

describe('SearchService', () => {
  let service: SearchService;
  const config = {
    get: jest.fn((key: string, defaultValue?: unknown) => defaultValue),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch.mockReset();
    mockClient.index.mockReturnValue(mockIndex);
    mockIndex.getRawInfo.mockReset().mockResolvedValue({});
    mockIndex.updateSettings.mockReset().mockResolvedValue({});
    mockClient.createIndex.mockReset().mockResolvedValue({});
    mockClient.health.mockReset().mockResolvedValue({ status: 'available' });
    mockFilterClean.mockImplementation((query: string) => query);
    (MeiliSearch as jest.Mock).mockImplementation(() => mockClient);
    service = new SearchService(config);
  });

  it('delegates sanitized queries to the courses index', async () => {
    const hits = [{ id: 'course-1', title: 'Baking Basics' }];
    mockSearch.mockResolvedValue({ hits, estimatedTotalHits: 1 });

    const result = await service.search({ query: '  baking  ' });

    expect(mockClient.index).toHaveBeenCalledWith('courses');
    expect(mockSearch).toHaveBeenCalledWith(
      'baking',
      expect.objectContaining({
        filter: 'status = ACTIVE',
        limit: 20,
        offset: 0,
      }),
    );
    expect(result).toMatchObject({
      hits,
      estimatedTotalHits: 1,
      totalPages: 1,
      query: 'baking',
    });
  });

  it('returns an empty result without contacting Meilisearch for blank queries', async () => {
    const result = await service.search({ query: '   ', page: 2, limit: 5 });

    expect(result).toMatchObject({
      hits: [],
      estimatedTotalHits: 0,
      page: 2,
      limit: 5,
      totalPages: 0,
    });
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('filters profanity before sending the query to Meilisearch', async () => {
    mockFilterClean.mockReturnValue('***');
    mockSearch.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

    await service.search({ query: 'badword' });

    expect(mockSearch).toHaveBeenCalledWith(
      '***',
      expect.objectContaining({ filter: 'status = ACTIVE' }),
    );
  });

  it('propagates Meilisearch errors instead of returning a success-shaped result', async () => {
    const error = new Error('Meilisearch unavailable');
    mockSearch.mockRejectedValue(error);

    await expect(service.search({ query: 'baking' })).rejects.toBe(error);
  });

  it('returns a duration when the Meilisearch health check is available', async () => {
    await expect(service.ping()).resolves.toEqual(expect.any(Number));
    expect(mockClient.health).toHaveBeenCalledTimes(1);
  });

  it('rejects when the Meilisearch health check is unavailable', async () => {
    mockClient.health.mockResolvedValue({ status: 'degraded' });

    await expect(service.ping()).rejects.toThrow(
      'Meilisearch not available (reported status: degraded)',
    );
  });

  it('creates a missing index and applies the declared index settings', async () => {
    mockIndex.getRawInfo.mockRejectedValue(new Error('index missing'));

    await service.onModuleInit();

    expect(mockClient.createIndex).toHaveBeenCalledWith('courses', { primaryKey: 'id' });
    expect(mockIndex.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      searchableAttributes: [
        'title',
        'description',
        'category',
        'level',
        'language',
        'instructorName',
      ],
      filterableAttributes: ['category', 'level', 'language', 'status'],
      sortableAttributes: ['avgRating', 'totalEnrollments', 'price', 'lastIndexedAt'],
    }));
  });

  it('logs and swallows index initialization failures', async () => {
    mockIndex.getRawInfo.mockRejectedValue(new Error('index unavailable'));
    mockClient.createIndex.mockRejectedValue(new Error('Meilisearch unavailable'));
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledWith(
      'Failed to initialise Meilisearch index: Meilisearch unavailable',
    );
    errorLog.mockRestore();
  });
});
