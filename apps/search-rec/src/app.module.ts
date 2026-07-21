// 이 파일의 책임: search-rec 서비스 루트 모듈 — SearchRecModule 조립 + 진짜 의존성 ping health
import { Controller, Get, Inject, Module } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { SearchRecModule } from './search-rec.module';

const pgPool = new Pool({
  connectionString:
    process.env['DATABASE_URL'] ?? 'postgresql://portfolio:change-me@localhost:5432/portfolio',
});

const redis = new Redis(
  process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  {
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      if (times > 10) return null; // stop retrying after 10 attempts
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  },
);

@Controller()
export class HealthController {
  constructor(
    @Inject('PG_POOL') private readonly pg: Pool,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
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
    const allUp = Object.values(deps).every((v) => v === 'up');
    return { status: allUp ? 'ok' : 'degraded', deps };
  }
}

@Module({
  imports: [
    SearchRecModule.forRoot({
      pgPool,
      redis,
      similarityThreshold: 0.7,
      cacheTtlSeconds: 300,
    }),
  ],
  controllers: [HealthController],
  providers: [
    { provide: 'PG_POOL', useValue: pgPool },
    { provide: 'REDIS_CLIENT', useValue: redis },
  ],
})
export class AppModule {}
