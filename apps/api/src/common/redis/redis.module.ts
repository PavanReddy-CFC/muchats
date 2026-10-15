import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

// A bare ioredis client returned from a factory provider gets no lifecycle hook from Nest —
// app.close() only calls onModuleDestroy on injectable classes, so without this wrapper the
// connection (and its socket) leaks past shutdown, which is exactly what left Jest hanging
// ("did not exit one second after the test run has completed") on every e2e run.
@Injectable()
class RedisConnection implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.get<string>('REDIS_URL')!, {
      maxRetriesPerRequest: null,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}

@Global()
@Module({
  providers: [
    RedisConnection,
    {
      provide: REDIS_CLIENT,
      inject: [RedisConnection],
      useFactory: (connection: RedisConnection) => connection.client,
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
