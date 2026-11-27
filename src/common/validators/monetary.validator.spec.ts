import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { isValidUsdcAmount, IsUsdcAmount, IsFutureDate } from './monetary.validator';

// ---------------------------------------------------------------------------
// isValidUsdcAmount (pure function tests)
// ---------------------------------------------------------------------------

describe('isValidUsdcAmount (Issue #17)', () => {
  it('returns false for 1e10 (overflows when scaled)', () => {
    expect(isValidUsdcAmount(1e10)).toBe(false);
  });

  it('returns true for 0.0000001 (1 stroops — minimum positive amount)', () => {
    expect(isValidUsdcAmount(0.0000001)).toBe(true);
  });

  it('returns false for 0 by default', () => {
    expect(isValidUsdcAmount(0)).toBe(false);
  });

  it('returns true for 0 when allowZero is true', () => {
    expect(isValidUsdcAmount(0, true)).toBe(true);
  });

  it('returns false for negative values', () => {
    expect(isValidUsdcAmount(-1)).toBe(false);
  });

  it('returns false for non-finite values', () => {
    expect(isValidUsdcAmount(Infinity)).toBe(false);
    expect(isValidUsdcAmount(NaN)).toBe(false);
  });

  it('returns false for non-number types', () => {
    expect(isValidUsdcAmount('1')).toBe(false);
    expect(isValidUsdcAmount(null)).toBe(false);
  });

  it('returns true for a typical valid amount (10.5)', () => {
    expect(isValidUsdcAmount(10.5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// IsUsdcAmount decorator (class-validator integration)
// ---------------------------------------------------------------------------

class UsdcDto {
  @IsUsdcAmount()
  amount!: number;
}

class UsdcAllowZeroDto {
  @IsUsdcAmount({ allowZero: true })
  amount!: number;
}

describe('IsUsdcAmount decorator (Issue #17)', () => {
  async function errors(plain: Record<string, unknown>, Dto: new () => object = UsdcDto) {
    const dto = plainToInstance(Dto, plain, { enableImplicitConversion: true });
    const result = await validate(dto as object);
    return result.map((e) => e.property);
  }

  it('passes for a valid amount', async () => {
    expect(await errors({ amount: 10.5 })).toHaveLength(0);
  });

  it('fails for 0 by default', async () => {
    expect(await errors({ amount: 0 })).toContain('amount');
  });

  it('passes for 0 when allowZero is true', async () => {
    expect(await errors({ amount: 0 }, UsdcAllowZeroDto)).toHaveLength(0);
  });

  it('fails for 1e10', async () => {
    expect(await errors({ amount: 1e10 })).toContain('amount');
  });
});

// ---------------------------------------------------------------------------
// IsFutureDate decorator
// ---------------------------------------------------------------------------

class DateDto {
  @IsFutureDate()
  date!: Date | string;
}

describe('IsFutureDate decorator (Issue #17)', () => {
  const future = new Date(Date.now() + 86_400_000); // tomorrow
  const past   = new Date(Date.now() - 86_400_000); // yesterday

  async function errors(plain: Record<string, unknown>) {
    const dto = plainToInstance(DateDto, plain, { enableImplicitConversion: false });
    const result = await validate(dto as object);
    return result.map((e) => e.property);
  }

  it('accepts a future Date instance', async () => {
    expect(await errors({ date: future })).toHaveLength(0);
  });

  it('accepts a future ISO string', async () => {
    expect(await errors({ date: future.toISOString() })).toHaveLength(0);
  });

  it('rejects a past date', async () => {
    expect(await errors({ date: past })).toContain('date');
  });

  it('rejects an invalid date string', async () => {
    expect(await errors({ date: 'not-a-date' })).toContain('date');
  });
});
