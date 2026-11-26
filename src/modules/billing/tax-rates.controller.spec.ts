import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TaxRatesController, parseRegion } from './tax-rates.controller';
import { FeeCalculatorService } from './fee-calculator.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

describe('TaxRatesController (#104)', () => {
  let controller: TaxRatesController;

  const mockFeeCalculator = {
    listTaxRates: jest.fn(),
    upsertTaxRate: jest.fn(),
    removeTaxRate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TaxRatesController],
      providers: [{ provide: FeeCalculatorService, useValue: mockFeeCalculator }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(TaxRatesController);
    jest.clearAllMocks();
  });

  it('lists tax rates', async () => {
    mockFeeCalculator.listTaxRates.mockResolvedValue([{ region: 'DEFAULT', ratePercent: 0 }]);
    await expect(controller.findAll()).resolves.toEqual([{ region: 'DEFAULT', ratePercent: 0 }]);
  });

  describe('PUT /admin/tax-rates/:region', () => {
    const dto = { ratePercent: 7.5, description: 'Nigeria VAT' };

    it('uppercases the region before calling the service', async () => {
      mockFeeCalculator.upsertTaxRate.mockResolvedValue({ region: 'NG', ...dto });
      await controller.upsert('ng', dto as any);
      expect(mockFeeCalculator.upsertTaxRate).toHaveBeenCalledWith('NG', dto);
    });

    it.each(['EU', 'eu', 'DEFAULT', 'default', 'US'])('accepts %s', async (region) => {
      await controller.upsert(region, dto as any);
      expect(mockFeeCalculator.upsertTaxRate).toHaveBeenCalledWith(region.toUpperCase(), dto);
    });

    it.each(['N', 'NGA', 'N1', 'EUR', 'DEFAULTS', '', 'n g', '12'])(
      'rejects %p with BadRequestException',
      (region) => {
        expect(() => controller.upsert(region, dto as any)).toThrow(BadRequestException);
        expect(mockFeeCalculator.upsertTaxRate).not.toHaveBeenCalled();
      },
    );
  });

  describe('DELETE /admin/tax-rates/:region', () => {
    it('uppercases the region before calling the service', async () => {
      mockFeeCalculator.removeTaxRate.mockResolvedValue({ deleted: true });
      await controller.remove('gb');
      expect(mockFeeCalculator.removeTaxRate).toHaveBeenCalledWith('GB');
    });

    it('rejects a malformed region with BadRequestException', () => {
      expect(() => controller.remove('not-a-region')).toThrow(BadRequestException);
      expect(mockFeeCalculator.removeTaxRate).not.toHaveBeenCalled();
    });

    it('passes the service NotFoundException through for an unconfigured region', async () => {
      mockFeeCalculator.removeTaxRate.mockRejectedValue(new NotFoundException('No tax rate configured for region "FR"'));
      await expect(controller.remove('fr')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('parseRegion trims whitespace', () => {
    expect(parseRegion(' ng ')).toBe('NG');
  });
});
