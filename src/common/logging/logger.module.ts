// logger.module.ts
import { Injectable, Module, NestMiddleware, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { Request, Response, NextFunction } from 'express';

const VALID_LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

// Request/response fields that must never reach the logs verbatim.
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body.signature',
  'req.body.signedNonce',
  'req.body.totpCode',
  'req.body.code',
  'req.body.password',
  'req.body.secret',
  'req.body.twoFactorSecret',
  'req.body.recoveryCodes',
  'req.body.accessToken',
  '*.password',
  '*.secret',
  '*.accessToken',
  '*.twoFactorSecret',
  '*.twoFactorRecoveryCodes',
];

/**
 * Request-scoped store that carries the correlation ID across async boundaries
 * (services, queue enqueues, Sentry captures) without threading it manually.
 */
export const correlationIdStorage = new AsyncLocalStorage<{ correlationId: string }>();

/** Returns the correlation ID of the current request, if any. */
export function getCorrelationId(): string | undefined {
  return correlationIdStorage.getStore()?.correlationId;
}

/**
 * Runs each HTTP request inside the correlationIdStorage context so that
 * getCorrelationId() returns the same ID that pino-http assigned as req.id.
 *
 * Must be applied after pino-http middleware (i.e. registered after
 * PinoLoggerModule is initialised) so that req.id is already set by the time
 * this middleware executes.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request & { id?: string }, _res: Response, next: NextFunction): void {
    // pino-http sets req.id via genReqId; fall back to the header in case the
    // middleware somehow runs before pino-http (should not happen in practice).
    const correlationId =
      req.id ??
      (req.headers['x-correlation-id'] as string | undefined) ??
      randomUUID();

    correlationIdStorage.run({ correlationId }, next);
  }
}

function resolveLogLevel(config: ConfigService, nodeEnv: string): string {
  const defaultLevel = nodeEnv === 'production' ? 'info' : 'debug';
  const configured = config.get<string>('LOG_LEVEL');
  if (!configured) return defaultLevel;

  if (!VALID_LOG_LEVELS.includes(configured)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[LoggerModule] Invalid LOG_LEVEL "${configured}" for environment "${nodeEnv}" — falling back to "${defaultLevel}". ` +
        `Valid levels: ${VALID_LOG_LEVELS.join(', ')}.`,
    );
    return defaultLevel;
  }

  return configured;
}

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const nodeEnv = config.get<string>('NODE_ENV', 'development');
        const level = resolveLogLevel(config, nodeEnv);

        return {
          pinoHttp: {
            level,
            genReqId: (req: any, res: any) => {
              const existing = req.headers['x-correlation-id'];
              const correlationId = (Array.isArray(existing) ? existing[0] : existing) || randomUUID();
              res.setHeader('x-correlation-id', correlationId);
              return correlationId;
            },
            customProps: (req: any) => ({ correlationId: req.id }),
            redact: {
              paths: REDACTED_PATHS,
              censor: '[REDACTED]',
            },
            // No transport is configured — pino always emits newline-delimited JSON.
          },
        };
      },
    }),
  ],
  providers: [CorrelationIdMiddleware],
  exports: [PinoLoggerModule, CorrelationIdMiddleware],
})
export class LoggerModule implements NestModule {
  /**
   * Register CorrelationIdMiddleware globally after pino-http so that
   * getCorrelationId() is populated for the entire request lifecycle.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
