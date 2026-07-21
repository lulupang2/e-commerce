// 이 리포지토리의 책임: popularity 신호 SQL — 뷰/판매 수 log-scaled 점수 + 카테고리 집계
import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';

export interface PopularityRow {
  product_id: number;
  popularity_score: number;
}

@Injectable()
export class PopularityRepository {
  private readonly logger = new Logger(PopularityRepository.name);

  constructor(private readonly pool: Pool) {}

  /** 복수 상품의 popularity score 조회 (정규화 전 원점수) */
  async getScores(productIds: number[]): Promise<Map<number, number>> {
    if (productIds.length === 0) return new Map();
    const sql = /* sql */ `
      SELECT product_id,
             LOG(GREATEST(1::numeric, view_count)) * 0.7
           + LOG(GREATEST(1::numeric, sale_count)) * 0.3 AS popularity_score
      FROM product_views
      WHERE product_id = ANY ($1::bigint[])
    `;
    const result = await this.pool.query(sql, [productIds]);
    const map = new Map<number, number>();
    for (const row of result.rows) {
      map.set(Number(row.product_id), Number(row.popularity_score));
    }
    return map;
  }

  /** 인기 상품 topK ID (특정 카테고리 필터 선택 — '전체'는 필터 무시) */
  async getTopPopular(topK: number, category?: string): Promise<number[]> {
    const filterAll = !category || category === '전체';
    if (filterAll) {
      const sql = /* sql */ `
        SELECT pv.product_id,
               LOG(GREATEST(1::numeric, pv.view_count)) * 0.7
             + LOG(GREATEST(1::numeric, pv.sale_count)) * 0.3 AS popularity_score
        FROM product_views pv
        JOIN products p ON p.id = pv.product_id
        WHERE p.status = 'ACTIVE'
        ORDER BY popularity_score DESC
        LIMIT $1
      `;
      const result = await this.pool.query<{ product_id: string }>(sql, [topK]);
      return result.rows.map((r) => Number(r.product_id));
    }

    const sql = /* sql */ `
      SELECT pv.product_id,
             LOG(GREATEST(1::numeric, pv.view_count)) * 0.7
           + LOG(GREATEST(1::numeric, pv.sale_count)) * 0.3 AS popularity_score
      FROM product_views pv
      JOIN products p ON p.id = pv.product_id
      WHERE p.status = 'ACTIVE'
        AND p.metadata->>'category' = $1
      ORDER BY popularity_score DESC
      LIMIT $2
    `;
    const result = await this.pool.query<{ product_id: string }>(sql, [category, topK]);
    return result.rows.map((r) => Number(r.product_id));
  }
}
