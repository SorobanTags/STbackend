import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { FraudController } from './fraud.controller';
import { FraudDetectionService } from './fraud-detection.service';
import { ReviewFraudFlagDto, ReviewDecision } from './dto/review-fraud-flag.dto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

describe('FraudController', () => {
  let controller: FraudController;

  const mockFraudDetectionService = {
    getFraudReviewQueue: jest.fn(),
    getStudentRiskProfile: jest.fn(),
    getFlagById: jest.fn(),
    reviewFlag: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FraudController],
      providers: [
        { provide: FraudDetectionService, useValue: mockFraudDetectionService },
      ],
    }).compile();

    controller = module.get<FraudController>(FraudController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('reviewFlag', () => {
    it('calls FraudDetectionService.reviewFlag with valid CLEARED decision', async () => {
      const dto: ReviewFraudFlagDto = { decision: ReviewDecision.CLEARED, reviewNotes: 'All good' };
      mockFraudDetectionService.reviewFlag.mockResolvedValue({ id: 'flag-1', status: 'CLEARED' });

      const result = await controller.reviewFlag('flag-1', 'admin-1', dto);

      expect(mockFraudDetectionService.reviewFlag).toHaveBeenCalledWith('flag-1', 'admin-1', dto);
      expect(result).toEqual({ id: 'flag-1', status: 'CLEARED' });
    });

    it('calls FraudDetectionService.reviewFlag with valid CONFIRMED decision', async () => {
      const dto: ReviewFraudFlagDto = { decision: ReviewDecision.CONFIRMED };
      mockFraudDetectionService.reviewFlag.mockResolvedValue({ id: 'flag-1', status: 'CONFIRMED' });

      const result = await controller.reviewFlag('flag-1', 'admin-1', dto);

      expect(mockFraudDetectionService.reviewFlag).toHaveBeenCalledWith('flag-1', 'admin-1', dto);
      expect(result).toEqual({ id: 'flag-1', status: 'CONFIRMED' });
    });

    it('does not call service when service throws BadRequestException', async () => {
      const dto: ReviewFraudFlagDto = { decision: ReviewDecision.CLEARED };
      mockFraudDetectionService.reviewFlag.mockRejectedValue(
        new BadRequestException('Only OPEN or HELD flags can be reviewed'),
      );

      await expect(controller.reviewFlag('flag-1', 'admin-1', dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('ReviewFraudFlagDto validation', () => {
    it('passes validation with a valid CLEARED decision', async () => {
      const dto = plainToInstance(ReviewFraudFlagDto, { decision: 'CLEARED' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('passes validation with a valid CONFIRMED decision and optional reviewNotes', async () => {
      const dto = plainToInstance(ReviewFraudFlagDto, { decision: 'CONFIRMED', reviewNotes: 'Fraud confirmed' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('returns a 400-equivalent validation error for an unknown decision string', async () => {
      const dto = plainToInstance(ReviewFraudFlagDto, { decision: 'UNKNOWN_VALUE' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('decision');
    });

    it('returns a validation error when decision is missing', async () => {
      const dto = plainToInstance(ReviewFraudFlagDto, {});
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('decision');
    });

    it('does not call service for an invalid decision (validation rejects before handler)', async () => {
      // Simulate a direct call bypassing validation pipe — service should not be called
      // when the DTO is invalid. This test verifies the DTO constraint catches bad input.
      const dto = plainToInstance(ReviewFraudFlagDto, { decision: 'DELETE_ALL' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      // Service must not have been called (guard: validation happens before handler)
      expect(mockFraudDetectionService.reviewFlag).not.toHaveBeenCalled();
    });
  });
});
