// 이 파일의 책임: Redis 검색 결과 캐시 — query 정규화 + topK 별 키, TTL 기반 만료
import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class SearchCacheService {
  private readonly logger = new Logger(SearchCacheService.name);

  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number = 300,
  ) {}

  /** 쿼리 정규화: trim, 소문자, 공백 단일화, 구두점 제거 */
  private normalizeQuery(q: string): string {
    return q
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s가-힣]/g, '');
  }

  private buildKey(query: string, topK: number): string {
    return `search:sem:q:${this.normalizeQuery(query)}:k:${topK}`;
  }

  async get<T>(query: string, topK: number): Promise<T | null> {
    try {
      const raw = await this.redis.get(this.buildKey(query, topK));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set(query: string, topK: number, data: unknown): Promise<void> {
    try {
      await this.redis.set(
        this.buildKey(query, topK),
        JSON.stringify(data),
        'EX',
        this.ttlSeconds,
      );
    } catch {
      // cache miss is non-fatal
    }
  }
}
