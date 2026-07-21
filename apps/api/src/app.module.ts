// API 게이트웨이 루트 모듈 — search-rec 모듈 주입 (pg, redis 전달)
import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { SearchRecModule } from '@search/search-rec';

const pgPool = new Pool({
  connectionString:
    process.env['DATABASE_URL'] ?? 'postgresql://portfolio:change-me@localhost:5432/portfolio',
});

const redis = new Redis({
  host: process.env['REDIS_HOST'] ?? 'localhost',
  port: process.env['REDIS_PORT'] ? Number(process.env['REDIS_PORT']) : 6379,
  password: process.env['REDIS_PASSWORD'] ?? 'change-me',
});

@Module({
  imports: [
    SearchRecModule.forRoot({
      pgPool,
      redis,
      similarityThreshold: 0.7,
      cacheTtlSeconds: 300,
    }),
  ],
})
export class AppModule {}
