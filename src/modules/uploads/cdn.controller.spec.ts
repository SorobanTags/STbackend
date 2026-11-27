import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CdnController, InvalidateCacheDto, ValidateSignedUrlDto, ResolveMediaDto } from './cdn.controller';
import { CdnService } from './cdn.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

const mockCdnService = {
  invalidateCache: jest.fn(),
  listInvalidationRequests: jest.fn(),
  getInvalidationRequest: jest.fn(),
  validateSignedUrl: jest.fn(),
  resolveWithOriginFallback: jest.fn(),
};

describe('CdnController', () => {
  let controller: CdnController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CdnController],
      providers: [{ provide: CdnService, useValue: mockCdnService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CdnController>(CdnController);
    jest.clearAllMocks();
  });

  describe('invalidate', () => {
    it('delegates to cdnService.invalidateCache with paths', async () => {
      const dto: InvalidateCacheDto = { paths: ['/uploads/videos/x.mp4'] };
      mockCdnService.invalidateCache.mockResolvedValue({ id: 'inv1' });
      const result = await controller.invalidate(dto);
      expect(mockCdnService.invalidateCache).toHaveBeenCalledWith(dto.paths);
      expect(result).toEqual({ id: 'inv1' });
    });
  });

  describe('listInvalidations', () => {
    it('delegates to cdnService.listInvalidationRequests', async () => {
      mockCdnService.listInvalidationRequests.mockResolvedValue([]);
      const result = await controller.listInvalidations();
      expect(mockCdnService.listInvalidationRequests).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('getInvalidation', () => {
    it('returns the invalidation request when found', async () => {
      const record = { id: 'inv1', paths: ['/x.mp4'], status: 'pending' };
      mockCdnService.getInvalidationRequest.mockReturnValue(record);
      const result = await controller.getInvalidation('inv1');
      expect(mockCdnService.getInvalidationRequest).toHaveBeenCalledWith('inv1');
      expect(result).toEqual(record);
    });

    it('throws NotFoundException when service returns undefined', () => {
      mockCdnService.getInvalidationRequest.mockReturnValue(undefined);
      expect(() => controller.getInvalidation('missing')).toThrow(NotFoundException);
    });
  });

  describe('validateSignedUrl', () => {
    it('delegates to cdnService.validateSignedUrl with the url', async () => {
      const dto: ValidateSignedUrlDto = { url: 'https://cdn.example.com/x.mp4?sig=abc' };
      mockCdnService.validateSignedUrl.mockResolvedValue({ valid: true });
      const result = await controller.validateSignedUrl(dto);
      expect(mockCdnService.validateSignedUrl).toHaveBeenCalledWith(dto.url);
      expect(result).toEqual({ valid: true });
    });
  });

  describe('resolve', () => {
    it('delegates to cdnService.resolveWithOriginFallback with cdnUrl and originUrl', async () => {
      const dto: ResolveMediaDto = {
        cdnUrl: 'https://cdn.example.com/x.mp4',
        originUrl: 'http://localhost:3000/x.mp4',
      };
      mockCdnService.resolveWithOriginFallback.mockResolvedValue({ url: dto.cdnUrl });
      const result = await controller.resolve(dto);
      expect(mockCdnService.resolveWithOriginFallback).toHaveBeenCalledWith(
        dto.cdnUrl,
        dto.originUrl,
      );
      expect(result).toEqual({ url: dto.cdnUrl });
    });
  });
});
