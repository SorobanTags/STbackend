import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-ioredis-yet';
import { CacheService } from './cache.service';

const DEFAULT_CACHE_TTL_MS = 60000;

@Module({
  imports: [
    NestCacheModule.registerAsync({
      isGlobal: false,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const ttl = Number(
          configService.get<string>('CACHE_TTL_MS') ?? DEFAULT_CACHE_TTL_MS,
        );

        const redisUrl = configService.get<string>('REDIS_URL');
        const redisHost = configService.get<string>('REDIS_HOST');

        if (redisUrl || redisHost) {
          const store = await redisStore({
            ...(redisUrl
              ? { url: redisUrl }
              : {
                  host: redisHost,
                  port: Number(configService.get<string>('REDIS_PORT') ?? 6379),
                  password: configService.get<string>('REDIS_PASSWORD'),
                }),
            ttl,
          });

          return { store, ttl };
        }

        return { ttl };
      },
    }),
  ],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
