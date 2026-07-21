// 이 서비스의 책임: 추천 결과 Redis 캐시 + signalVersion 기반 동기 invalidation
import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { RecommendConfig } from './recommend.config';
import { RecommendResponse } from '@shared/schemas';

@Injectable()
export class RecommendCacheService {
  private readonly homeTtl: number;
  private readonly relatedTtl: number;

  constructor(private readonly redis: Redis, ttl?: { home?: number; related?: number }) {
    this.homeTtl = ttl?.home ?? RecommendConfig.CACHE.HOME_TTL_SECONDS;
    this.relatedTtl = ttl?.related ?? RecommendConfig.CACHE.RELATED_TTL_SECONDS;
  }

  // ---- Key builders ---------------------------------------------------------

  private homeKey(userId: string, signalVersion: number): string {
    return `rec:home:${userId}:v${signalVersion}`;
  }

  private relatedKey(productId: number, topK: number): string {
    return `rec:related:${productId}:k:${topK}`;
  }

  // ---- Cache Ops -----------------------------------------------------------

  async getHome(userId: string, signalVersion: number): Promise<RecommendResponse | null> {
    const raw = await this.redis.get(this.homeKey(userId, signalVersion));
    return raw ? (JSON.parse(raw) as RecommendResponse) : null;
  }

  async setHome(
    userId: string,
    signalVersion: number,
    data: RecommendResponse,
  ): Promise<void> {
    await this.redis.set(
      this.homeKey(userId, signalVersion),
      JSON.stringify(data),
      'EX',
      this.homeTtl,
    );
  }

  async getRelated(productId: number, topK: number): Promise<RecommendResponse | null> {
    const raw = await this.redis.get(this.relatedKey(productId, topK));
    return raw ? (JSON.parse(raw) as RecommendResponse) : null;
  }

  async setRelated(
    productId: number,
    topK: number,
    data: RecommendResponse,
  ): Promise<void> {
    await this.redis.set(
      this.relatedKey(productId, topK),
      JSON.stringify(data),
      'EX',
      this.relatedTtl,
    );
  }

  // ---- signalVersion (동기 invalidation) -------------------------------------

  async getSignalVersion(userId: string): Promise<number> {
    const raw = await this.redis.get(`rec:signalv:${userId}`);
    return raw ? Number(raw) : 0;
  }

  async incrementSignalVersion(userId: string): Promise<number> {
    return this.redis.incr(`rec:signalv:${userId}`);
  }

  /** 장바구니 추가 / 상품 조회 시 호출 (동기 invalidation) */
  async invalidateHome(userId: string): Promise<void> {
    await this.incrementSignalVersion(userId);
  }

  /** 상품 정보 변경 시 관련 추천 무효화 */
  async invalidateProduct(productId: number): Promise<void> {
    const keys = await this.redis.keys(`rec:related:${productId}:k:*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
