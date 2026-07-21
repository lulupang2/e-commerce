// 이 파일의 책임: ai-gen 서비스 루트 모듈 — AiGenModule 조립 + consumer 생존 포함 health
import { Controller, Get, Inject, Module } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { AiGenModule } from './ai-gen.module';
import { StreamConsumer } from './consumer/stream.consumer';

const pgPool = new Pool({
  connectionString:
    process.env['DATABASE_URL'] ?? 'postgresql://portfolio:change-me@localhost:5432/portfolio',
});

const redis = new Redis({
  host: process.env['REDIS_HOST'] ?? 'localhost',
  port: process.env['REDIS_PORT'] ? Number(process.env['REDIS_PORT']) : 6379,
  password: process.env['REDIS_PASSWORD'] ?? 'change-me',
});

@Controller()
export class HealthController {
  constructor(
    @Inject('PG_POOL') private readonly pg: Pool,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @Inject(StreamConsumer) private readonly consumer: StreamConsumer,
  ) {}

  @Get('health')
  async health(): Promise<Record<string, unknown>> {
    const deps: Record<string, string> = {};
    try {
      await this.pg.query('SELECT 1');
      deps['pg'] = 'up';
    } catch {
      deps['pg'] = 'down';
    }
    try {
      deps['redis'] = (await this.redis.ping()) === 'PONG' ? 'up' : 'down';
    } catch {
      deps['redis'] = 'down';
    }
    deps['consumer'] = this.consumer.isRunning() ? 'running' : 'stopped';
    const allUp = deps['pg'] === 'up' && deps['redis'] === 'up' && deps['consumer'] === 'running';
    return { status: allUp ? 'ok' : 'degraded', deps };
  }
}

@Module({
  imports: [AiGenModule.forRoot({ pgPool, redis })],
  controllers: [HealthController],
  providers: [
    { provide: 'PG_POOL', useValue: pgPool },
    { provide: 'REDIS_CLIENT', useValue: redis },
  ],
})
export class AppModule {}
