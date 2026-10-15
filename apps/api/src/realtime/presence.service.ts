import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { PresenceStatus } from '@qennect/shared-types';
import { REDIS_CLIENT } from '../common/redis/redis.module';

const PRESENCE_TTL_SECONDS = 60;

@Injectable()
export class PresenceService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(tenantId: string, userId: string): string {
    return `presence:${tenantId}:${userId}`;
  }

  async heartbeat(tenantId: string, userId: string): Promise<void> {
    await this.redis.set(
      this.key(tenantId, userId),
      JSON.stringify({ status: PresenceStatus.ONLINE, lastSeenAt: new Date().toISOString() }),
      'EX',
      PRESENCE_TTL_SECONDS,
    );
  }

  async markOffline(tenantId: string, userId: string): Promise<void> {
    await this.redis.set(
      this.key(tenantId, userId),
      JSON.stringify({ status: PresenceStatus.OFFLINE, lastSeenAt: new Date().toISOString() }),
      'EX',
      PRESENCE_TTL_SECONDS,
    );
  }

  async getStatus(tenantId: string, userId: string): Promise<{ status: PresenceStatus; lastSeenAt: string }> {
    const raw = await this.redis.get(this.key(tenantId, userId));
    if (!raw) return { status: PresenceStatus.OFFLINE, lastSeenAt: new Date(0).toISOString() };
    return JSON.parse(raw);
  }
}
