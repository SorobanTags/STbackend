import { Test, TestingModule } from '@nestjs/testing';
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
    Contract: jest.fn().mockImplementation(() => mockContract),
  };
});

describe('StellarService', () => {
  let service: StellarService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [StellarService],
    }).compile();

    service = module.get<StellarService>(StellarService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('successful contract simulation', () => {
    it('returns the parsed simulation result', async () => {
      const parsedResult = { result: 'ok' };
      mockServer.simulateTransaction.mockResolvedValue({
        result: parsedResult,
        error: undefined,
      });

      const result = await (service as any).simulateContractCall(
        'CONTRACT_ID',
        'method',
        [],
      );

      expect(mockServer.simulateTransaction).toHaveBeenCalled();
      expect(result).toEqual(parsedResult);
    });
  });

  describe('simulation error', () => {
    it('throws when the simulation response contains an error', async () => {
      mockServer.simulateTransaction.mockResolvedValue({
        error: 'simulation failed',
      });

      await expect(
        (service as any).simulateContractCall('CONTRACT_ID', 'method', []),
      ).rejects.toThrow();
    });
  });

  describe('RPC rejection', () => {
    it('propagates a rejected RPC call as an error', async () => {
      mockServer.simulateTransaction.mockRejectedValue(
        new Error('network error'),
      );

      await expect(
        (service as any).simulateContractCall('CONTRACT_ID', 'method', []),
      ).rejects.toThrow();
    });
  });
});
