import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SearchService } from './search.service';

// Minimal MeiliSearch mock
const mockGetRawInfo = jest.fn();
const mockCreateIndex = jest.fn();
const mockUpdateSettings = jest.fn();
const mockSearch = jest.fn();
const mockHealth = jest.fn();

jest.mock('meilisearch', () => ({
  MeiliSearch: jest.fn().mockImplementation(() => ({
    health: mockHealth,
    createIndex: mockCreateIndex,
    index: jest.fn().mockReturnValue({
      getRawInfo: mockGetRawInfo,
      updateSettings: mockUpdateSettings,
      search: mockSearch,
      addDocuments: jest.fn(),
      deleteDocument: jest.fn(),
      getDocument: jest.fn(),
    }),
  })),
}));

describe('SearchService (Meilisearch)', () => {
  let service: SearchService;

  const buildModule = async (): Promise<TestingModule> => {
    return Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def: string) => def),
          },
        },
      ],
    }).compile();
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets indexReady to true after a successful ensureIndex', async () => {
    mockGetRawInfo.mockResolvedValue({});
    mockUpdateSettings.mockResolvedValue({});

    const moduleRef = await buildModule();
    service = moduleRef.get(SearchService);
    await service.onModuleInit();

    expect(service.isIndexReady()).toBe(true);
  });

  it('leaves indexReady false after a rejected ensureIndex', async () => {
    mockGetRawInfo.mockRejectedValue(new Error('connection refused'));
    mockCreateIndex.mockRejectedValue(new Error('connection refused'));

    const moduleRef = await buildModule();
    service = moduleRef.get(SearchService);
    await service.onModuleInit();

    expect(service.isIndexReady()).toBe(false);
  });

  it('sets indexReady to true after a successful retry', async () => {
    // First call fails, second succeeds
    mockGetRawInfo
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue({});
    mockCreateIndex.mockRejectedValue(new Error('timeout'));
    mockUpdateSettings.mockResolvedValue({});

    const moduleRef = await buildModule();
    service = moduleRef.get(SearchService);

    // Replace retryDelayMs behaviour by directly calling initialiseIndex again
    await service.onModuleInit(); // fails
    expect(service.isIndexReady()).toBe(false);

    // Simulate retry by calling the private method via re-init
    await (service as any).initialiseIndex(); // succeeds
    expect(service.isIndexReady()).toBe(true);
  });

  afterEach(async () => {
    if (service) {
      await service.onModuleDestroy();
    }
  });
});
