import { plainToInstance } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsEmail,
  Matches,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export enum LogLevel {
  Fatal = 'fatal',
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Debug = 'debug',
  Trace = 'trace',
  Silent = 'silent',
}

/**
 * Issue #166 — structured environment variable schema validated at bootstrap.
 *
 * Fields without @IsOptional() are required: a missing or malformed required
 * variable fails fast with a clear error listing every problem.
 */
export class EnvironmentVariables {
  // ----------------------------------------------------------
  // Server
  // ----------------------------------------------------------
  @IsOptional()
  @IsEnum(NodeEnv)
  NODE_ENV?: NodeEnv;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'PORT must be a numeric port' })
  PORT?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  API_PREFIX?: string;

  @IsOptional()
  @IsUrl({}, { message: 'APP_BASE_URL must be a valid URL' })
  APP_BASE_URL?: string;

  @IsOptional()
  @IsUrl({}, { message: 'PUBLIC_API_URL must be a valid URL' })
  PUBLIC_API_URL?: string;

  @IsOptional()
  @IsUrl({}, { message: 'FRONTEND_URL must be a valid URL' })
  FRONTEND_URL?: string;

  @IsOptional()
  @IsEnum(LogLevel)
  LOG_LEVEL?: LogLevel;

  // ----------------------------------------------------------
  // Sentry
  // ----------------------------------------------------------
  @IsOptional()
  @IsUrl({}, { message: 'SENTRY_DSN must be a valid URL' })
  SENTRY_DSN?: string;

  @IsOptional()
  @IsString()
  SENTRY_ENVIRONMENT?: string;

  @IsOptional()
  @IsString()
  SENTRY_RELEASE?: string;

  // ----------------------------------------------------------
  // JWT
  // ----------------------------------------------------------
  @IsDefined()
  @IsString()
  @MinLength(16, { message: 'JWT_SECRET must be at least 16 characters' })
  JWT_SECRET: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(ms|s|m|h|d|w|y)?$/, {
    message:
      'JWT_EXPIRES_IN must be a positive integer of seconds or a duration string (e.g. 15m, 1h, 7d)',
  })
  JWT_EXPIRES_IN?: string;

  @IsDefined()
  @IsString()
  @MinLength(16, { message: 'JWT_REFRESH_SECRET must be at least 16 characters' })
  JWT_REFRESH_SECRET: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(ms|s|m|h|d|w|y)?$/, {
    message:
      'JWT_REFRESH_EXPIRES_IN must be a positive integer of seconds or a duration string (e.g. 15m, 1h, 7d)',
  })
  JWT_REFRESH_EXPIRES_IN?: string;

  // ----------------------------------------------------------
  // Google OAuth
  // ----------------------------------------------------------
  @IsOptional()
  @IsString()
  GOOGLE_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  GOOGLE_CLIENT_SECRET?: string;

  @IsOptional()
  @IsUrl({}, { message: 'GOOGLE_CALLBACK_URL must be a valid URL' })
  GOOGLE_CALLBACK_URL?: string;

  // ----------------------------------------------------------
  // Database
  // ----------------------------------------------------------
  @IsDefined()
  @IsString()
  @MinLength(1, { message: 'DATABASE_URL is required' })
  DATABASE_URL: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'PRISMA_CONNECTION_LIMIT must be numeric' })
  PRISMA_CONNECTION_LIMIT?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'PRISMA_POOL_TIMEOUT_SECONDS must be numeric' })
  PRISMA_POOL_TIMEOUT_SECONDS?: string;

  // ----------------------------------------------------------
  // Stellar
  // ----------------------------------------------------------
  @IsOptional()
  @IsString()
  STELLAR_NETWORK?: string;

  @IsDefined()
  @IsUrl({}, { message: 'STELLAR_RPC_URL must be a valid URL' })
  STELLAR_RPC_URL: string;

  @IsDefined()
  @IsUrl({}, { message: 'STELLAR_HORIZON_URL must be a valid URL' })
  STELLAR_HORIZON_URL: string;

  @IsOptional()
  @IsString()
  SOROBANLARD_CONTRACT_ID?: string;

  @IsOptional()
  @IsString()
  USDC_TOKEN_ADDRESS?: string;

  @IsDefined()
  @Matches(/^G[1-9A-HJ-NP-Za-km-z]{55}$/, {
    message: 'ADMIN_STELLAR_ADDRESS must be a valid Stellar public key (starts with G, 56 chars)',
  })
  ADMIN_STELLAR_ADDRESS: string;

  @IsDefined()
  @Matches(/^G[1-9A-HJ-NP-Za-km-z]{55}$/, {
    message: 'TREASURY_STELLAR_ADDRESS must be a valid Stellar public key (starts with G, 56 chars)',
  })
  TREASURY_STELLAR_ADDRESS: string;

  // ----------------------------------------------------------
  // File storage / CDN
  // ----------------------------------------------------------
  @IsOptional()
  @IsString()
  UPLOAD_DIR?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'MAX_FILE_SIZE_MB must be numeric' })
  MAX_FILE_SIZE_MB?: string;

  @IsOptional()
  @IsUrl({}, { message: 'CDN_BASE_URL must be a valid URL' })
  CDN_BASE_URL?: string;

  @IsOptional()
  @IsUrl({}, { message: 'CDN_ORIGIN_BASE_URL must be a valid URL' })
  CDN_ORIGIN_BASE_URL?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  CDN_SIGNING_SECRET?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'CDN_SIGNED_URL_TTL_SECONDS must be numeric' })
  CDN_SIGNED_URL_TTL_SECONDS?: string;

  // ----------------------------------------------------------
  // Email (Nodemailer)
  // ----------------------------------------------------------
  @IsDefined()
  @IsString()
  SMTP_HOST: string;

  @IsDefined()
  @Matches(/^\d+$/, { message: 'SMTP_PORT must be numeric' })
  SMTP_PORT: string;

  @IsDefined()
  @IsString()
  SMTP_USER: string;

  @IsDefined()
  @IsString()
  SMTP_PASS: string;

  @IsDefined()
  @IsEmail({}, { message: 'EMAIL_FROM must be a valid email address' })
  EMAIL_FROM: string;

  // ----------------------------------------------------------
  // Redis / Queue
  // ----------------------------------------------------------
  @IsOptional()
  @IsUrl({}, { message: 'REDIS_URL must be a valid URL' })
  REDIS_URL?: string;

  @IsOptional()
  @IsString()
  REDIS_HOST?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'REDIS_PORT must be numeric' })
  REDIS_PORT?: string;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'QUEUE_JOB_ATTEMPTS must be numeric' })
  QUEUE_JOB_ATTEMPTS?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'QUEUE_RETRY_DELAY_MS must be numeric' })
  QUEUE_RETRY_DELAY_MS?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'CACHE_TTL_SECONDS must be numeric' })
  CACHE_TTL_SECONDS?: string;

  // ----------------------------------------------------------
  // Rate limiting
  // ----------------------------------------------------------
  @IsOptional()
  @Matches(/^\d+$/, { message: 'THROTTLE_TTL must be numeric' })
  THROTTLE_TTL?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'THROTTLE_LIMIT must be numeric' })
  THROTTLE_LIMIT?: string;

  // ----------------------------------------------------------
  // CAPTCHA
  // ----------------------------------------------------------
  @IsDefined()
  @IsString()
  @MinLength(1)
  CAPTCHA_SECRET_KEY: string;

  @IsOptional()
  @IsUrl({}, { message: 'CAPTCHA_VERIFY_URL must be a valid URL' })
  CAPTCHA_VERIFY_URL?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'CAPTCHA_TIMEOUT_MS must be numeric' })
  CAPTCHA_TIMEOUT_MS?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'CAPTCHA_MAX_FAILURES must be numeric' })
  CAPTCHA_MAX_FAILURES?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'CAPTCHA_BLOCK_DURATION_SECONDS must be numeric' })
  CAPTCHA_BLOCK_DURATION_SECONDS?: string;

  // ----------------------------------------------------------
  // Per-IP rate limiting middleware
  // ----------------------------------------------------------
  @IsOptional()
  @Matches(/^\d+$/, { message: 'RATE_LIMIT_WINDOW_MS must be numeric' })
  RATE_LIMIT_WINDOW_MS?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'RATE_LIMIT_STANDARD_MAX must be numeric' })
  RATE_LIMIT_STANDARD_MAX?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'RATE_LIMIT_SENSITIVE_MAX must be numeric' })
  RATE_LIMIT_SENSITIVE_MAX?: string;

  @IsOptional()
  @IsString()
  RATE_LIMIT_EXEMPT_IPS?: string;
}

/**
 * Validates the given environment object against the schema and throws a
 * descriptive error listing every problem when validation fails.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: false,
  });

  if (errors.length > 0) {
    const messages = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .filter(Boolean);
    throw new Error(`Environment validation failed:\n${messages.join('\n')}`);
  }

  return config;
}
