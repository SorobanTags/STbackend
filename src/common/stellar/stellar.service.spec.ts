import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Networks, SorobanRpc } from '@stellar/stellar-sdk';
import { StellarService } from './stellar.service';

const mockServer = {
  getAccount: jest.fn(),
  simulateTransaction: jest.fn(),
  sendTransaction: jest.fn(),
  getTransaction: jest.fn(),
};

const mockContract = {
  call: jest.fn(),
};

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    rpc: {
      ...(actual.rpc ?? {}),
      Server: jest.fn().mockImplementation(() => mockServer),
    },
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: jest.fn().mockImplementation(() => mockServer),
    },
    Contract: jest.fn().mockImplementation(() => mockContract),
  };
});

describe('StellarService', () => {
  let service: StellarService;
  let configService: { get: jest.Mock };
  let mockServer: { getNetworkPassphrase: jest.Mock; getEvents: jest.Mock };

  const buildConfig = (values: Record<string, string | undefined>) => ({
    get: jest.fn((key: string) => values[key]),
  });

  const createService = async (values: Record<string, string | undefined>) => {
    configService = buildConfig(values);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();
    return module.get<StellarService>(StellarService);
  };

  beforeEach(() => {
    mockServer = {
      getNetworkPassphrase: jest.fn().mockReturnValue(Networks.TESTNET),
      getEvents: jest.fn(),
    };
    (SorobanRpc.Server as unknown as jest.Mock).mockImplementation(
      () => mockServer,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('onModuleInit', () => {
    it('throws naming STELLAR_RPC_URL when it is unset', async () => {
      service = await createService({
        STELLAR_RPC_URL: undefined,
        STELLAR_NETWORK: 'testnet',
        SOROBANLARD_CONTRACT_ID: 'CABC123',
      });

      expect(() => service.onModuleInit()).toThrow(/STELLAR_RPC_URL/);
    });

    it('throws naming SOROBANLARD_CONTRACT_ID when it is unset', async () => {
      service = await createService({
        STELLAR_RPC_URL: 'https://rpc.example.com',
        STELLAR_NETWORK: 'testnet',
        SOROBANLARD_CONTRACT_ID: undefined,
      });

      expect(() => service.onModuleInit()).toThrow(/SOROBANLARD_CONTRACT_ID/);
    });

    it('throws for an unknown STELLAR_NETWORK value', async () => {
      service = await createService({
        STELLAR_RPC_URL: 'https://rpc.example.com',
        STELLAR_NETWORK: 'mainet',
        SOROBANLARD_CONTRACT_ID: 'CABC123',
      });

      expect(() => service.onModuleInit()).toThrow(/STELLAR_NETWORK/);
    });

    it('selects Networks.PUBLIC for mainnet', async () => {
      service = await createService({
        STELLAR_RPC_URL: 'https://rpc.example.com',
        STELLAR_NETWORK: 'mainnet',
        SOROBANLARD_CONTRACT_ID: 'CABC123',
      });

      service.onModuleInit();

      expect(SorobanRpc.Server).toHaveBeenCalledWith('https://rpc.example.com', {
        allowHttp: true,
      });
      expect(service.getNetworkPassphrase()).toBe(Networks.PUBLIC);
    });

    it('selects Networks.TESTNET for testnet', async () => {
      service = await createService({
        STELLAR_RPC_URL: 'https://rpc.example.com',
        STELLAR_NETWORK: 'testnet',
        SOROBANLARD_CONTRACT_ID: 'CABC123',
      });

      service.onModuleInit();

      expect(service.getNetworkPassphrase()).toBe(Networks.TESTNET);
    });
  });

  describe('fetchContractEvents', () => {
    beforeEach(async () => {
      service = await createService({
        STELLAR_RPC_URL: 'https://rpc.example.com',
        STELLAR_NETWORK: 'testnet',
        SOROBANLARD_CONTRACT_ID: 'CABC123',
      });
      service.onModuleInit();
    });

    it('rejects after maxAttempts when getEvents keeps failing', async () => {
      jest.useFakeTimers();
      const error = new Error('RPC unavailable');
      mockServer.getEvents.mockRejectedValue(error);

      const promise = service.fetchContractEvents(1);
      // Attach a catch handler immediately to avoid unhandled rejection warnings.
      const assertion = expect(promise).rejects.toThrow('RPC unavailable');

      // Advance through the exponential backoff delays.
      await jest.runAllTimersAsync();

      await assertion;
      expect(mockServer.getEvents).toHaveBeenCalledTimes(3);
    });

    it('returns [] for a successful empty response', async () => {
      mockServer.getEvents.mockResolvedValue({ events: [] });

      const result = await service.fetchContractEvents(1);

      expect(result).toEqual([]);
      expect(mockServer.getEvents).toHaveBeenCalledTimes(1);
    });
  });
});
