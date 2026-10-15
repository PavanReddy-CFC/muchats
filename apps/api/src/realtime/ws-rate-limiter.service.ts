import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module';

const WINDOW_SECONDS = 10;
const MAX_MESSAGES_PER_WINDOW = 30;

/** Fixed-window token bucket for WS message sends, scoped per (tenant, user). */
@Injectable()
export class WsRateLimiterService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async allow(tenantId: string, userId: string): Promise<boolean> {
    const key = `ratelimit:msg:${tenantId}:${userId}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, WINDOW_SECONDS);
    }
    return count <= MAX_MESSAGES_PER_WINDOW;
  }
}
