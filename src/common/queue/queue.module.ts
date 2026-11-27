import { Module, OnApplicationShutdown } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import { NOTIFICATION_EMAIL_QUEUE } from './queue.constants';
import { QueueService } from './queue.service';

/**
 * Builds the BullMQ connection configuration. When `REDIS_URL` is set the
 * connection is expressed as a plain options object (host/port/credentials)
 * so BullMQ owns the client; otherwise the same options shape is returned.
 * Both branches return a consistent `RedisOptions` object.
 */
export function buildRedisConnectionOptions(
  redisUrl?: string,
): RedisOptions {
  const base: RedisOptions = { maxRetriesPerRequest: null };

  if (!redisUrl) {
    return base;
  }

  const parsed = new URL(redisUrl);
  const options: RedisOptions = {
    ...base,
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
  };

  if (parsed.username) {
    options.username = decodeURIComponent(parsed.username);
  }
  if (parsed.password) {
    options.password = decodeURIComponent(parsed.password);
  }
  if (parsed.protocol === 'rediss:') {
    options.tls = {};
  }
  if (parsed.pathname && parsed.pathname !== '/') {
    options.db = Number(parsed.pathname.slice(1));
  }

  return options;
}

/**
 * Owns an optional ioredis client created from `REDIS_URL` and quits it on
 * application shutdown so sockets are not leaked. When no client is created
 * (BullMQ owns its own connection) `client` is `null`.
 */
export class RedisConnectionProvider implements OnApplicationShutdown {
  readonly client: Redis | null;

  constructor(redisUrl?: string) {
    this.client = redisUrl
      ? new Redis(buildRedisConnectionOptions(redisUrl))
      : null;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client) {
      await this.client.quit();
    }
  }
}

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: buildRedisConnectionOptions(
          config.get<string>('REDIS_URL'),
        ),
      }),
    }),
    BullModule.registerQueue({ name: NOTIFICATION_EMAIL_QUEUE }),
  ],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
