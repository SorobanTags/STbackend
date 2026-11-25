import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { EnvironmentVariables } from './env.validation';

const validEnv = {
  NODE_ENV: 'test',
  PORT: 3000,
  JWT_SECRET: 'a-very-long-secret-value',
  JWT_REFRESH_SECRET: 'another-very-long-secret-value',
  JWT_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '7d',
};

function validate(env: Record<string, unknown>) {
  const instance = plainToInstance(EnvironmentVariables, env, {
    enableImplicitConversion: true,
  });
  return validateSync(instance, { skipMissingProperties: false });
}

describe('EnvironmentVariables', () => {
  it('accepts a valid environment', () => {
    const errors = validate(validEnv);
    expect(errors).toHaveLength(0);
  });

  it('accepts integer seconds and duration strings for expiry values', () => {
    expect(validate({ ...validEnv, JWT_EXPIRES_IN: '3600' })).toHaveLength(0);
    expect(validate({ ...validEnv, JWT_EXPIRES_IN: '1h' })).toHaveLength(0);
    expect(validate({ ...validEnv, JWT_REFRESH_EXPIRES_IN: '30d' })).toHaveLength(0);
  });

  it('reports a missing required variable', () => {
    const { JWT_SECRET, ...rest } = validEnv;
    const errors = validate(rest);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.map((error) => error.property)).toContain('JWT_SECRET');
  });

  it('rejects a malformed JWT_EXPIRES_IN and names the variable', () => {
    const errors = validate({ ...validEnv, JWT_EXPIRES_IN: '15minutes' });

    expect(errors.length).toBeGreaterThan(0);
    const expiryError = errors.find((error) => error.property === 'JWT_EXPIRES_IN');
    expect(expiryError).toBeDefined();
    expect(JSON.stringify(expiryError?.constraints)).toContain('JWT_EXPIRES_IN');
  });

  it('rejects a malformed JWT_REFRESH_EXPIRES_IN and names the variable', () => {
    const errors = validate({ ...validEnv, JWT_REFRESH_EXPIRES_IN: 'abc' });

    expect(errors.length).toBeGreaterThan(0);
    const expiryError = errors.find(
      (error) => error.property === 'JWT_REFRESH_EXPIRES_IN',
    );
    expect(expiryError).toBeDefined();
    expect(JSON.stringify(expiryError?.constraints)).toContain(
      'JWT_REFRESH_EXPIRES_IN',
    );
  });
});
