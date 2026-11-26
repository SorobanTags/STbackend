// tax-rates.controller.ts
import {
  Controller, Get, Put, Delete, Body, Param, UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { FeeCalculatorService } from './fee-calculator.service';
import { UpsertTaxRateDto } from './dto/upsert-tax-rate.dto';

/** A 2-letter ISO country code, "EU" or "DEFAULT" (after uppercasing). */
const REGION_PATTERN = /^(?:[A-Z]{2}|EU|DEFAULT)$/;

/**
 * Uppercase and validate a `:region` path param (#104), so "ng" and "NG"
 * address the same row and malformed regions never reach the service.
 */
export function parseRegion(region: string): string {
  const normalized = String(region ?? '').trim().toUpperCase();
  if (!REGION_PATTERN.test(normalized)) {
    throw new BadRequestException(
      `Invalid region "${region}": expected a 2-letter ISO country code, "EU" or "DEFAULT"`,
    );
  }
  return normalized;
}

@ApiTags('admin/tax-rates')
@Controller('admin/tax-rates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class TaxRatesController {
  constructor(private readonly feeCalculator: FeeCalculatorService) {}

  @Get()
  @ApiOperation({ summary: 'List all configured regional tax rates (admin)' })
  findAll() {
    return this.feeCalculator.listTaxRates();
  }

  @Put(':region')
  @ApiOperation({ summary: 'Create or update the tax rate for a region (admin)' })
  @ApiParam({ name: 'region', description: 'ISO country code, "EU", or "DEFAULT"', example: 'NG' })
  upsert(@Param('region') region: string, @Body() dto: UpsertTaxRateDto) {
    return this.feeCalculator.upsertTaxRate(parseRegion(region), dto);
  }

  @Delete(':region')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a regional tax rate — the region falls back to DEFAULT (admin)' })
  @ApiParam({ name: 'region', example: 'NG' })
  remove(@Param('region') region: string) {
    return this.feeCalculator.removeTaxRate(parseRegion(region));
  }
}
