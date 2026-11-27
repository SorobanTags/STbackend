import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { EnvironmentVariables } from './env.validation';

function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  return validateSync(validatedConfig, {
    skipMissingProperties: false,
  });
}

const validEnv: Record<string, unknown> = {
  NODE_ENV: 'test',
  PORT: '3000',
  API_PREFIX: 'api',
  JWT_SECRET: 'a'.repeat(32),
  JWT_EXPIRES_IN: '1h',
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_REFRESH_EXPIRES_IN: '7d',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  REDIS_PASSWORD: 'secret',
  MEILISEARCH_HOST: 'http://localhost:7700',
  MEILISEARCH_API_KEY: 'masterKey',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'bucket',
  S3_ACCESS_KEY_ID: 'access',
  S3_SECRET_ACCESS_KEY: 'secret',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'user',
  SMTP_PASSWORD: 'pass',
  SMTP_FROM: 'no-reply@example.com',
};

describe('EnvironmentVariables', () => {
  it('passes with a valid full env', () => {
    const errors = validate(validEnv);
    expect(errors).toHaveLength(0);
  });

  it('fails when REDIS_PORT is not numeric', () => {
    const errors = validate({ ...validEnv, REDIS_PORT: 'not-a-port' });
    expect(errors.length).toBeGreaterThan(0);
    const redisPortError = errors.find((e) => e.property === 'REDIS_PORT');
    expect(redisPortError).toBeDefined();
    expect(redisPortError?.constraints).toBeDefined();
    expect(Object.keys(redisPortError?.constraints ?? {})).toContain('matches');
  });
});
