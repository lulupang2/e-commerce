// 이 리포지토리의 책임: pgvector raw SQL — cosine(<=>) 벡터 검색 + pg_trgm similarity 키워드 폴백
// 트레이드오프: pg/node-postgres raw query는 ORM 대비 안전(파라미터 바인딩 $1,$2)하지만
//   pgvector 특화 기능(IVFFlat, HNSW 옵션)을 SQL로 직접 관리해야 하며,
//   마이그레이션/인덱스 생성도 별도 SQL 파일로 유지보수 필요.
//   → TypeORM pgvector 브릿지 대비 더 많은 로우레벨 제어, 덜한 마법.
// 주의: node-postgres는 NUMERIC을 string으로 반환 → price::float8 로 캐스트
//       DB snake_case 컬럼을 camelCase alias 로 Zod 스키마와 정렬
import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';

/** 검색 결과 행 (camelCase — Zod ProductSchema 호환) */
export interface SemanticSearchRow {
  id: number;
  uuid: string;
  sku: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  stock: number;
  status: 'DRAFT' | 'ACTIVE' | 'SOLD_OUT' | 'ARCHIVED';
  metadata: Record<string, unknown>;
  similarity: number;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class ProductVectorRepository {
  private readonly logger = new Logger(ProductVectorRepository.name);

  constructor(private readonly pool: Pool) {}

  private mapRow(row: Record<string, unknown>): SemanticSearchRow {
    return {
      id: Number(row['id']),
      uuid: String(row['uuid']),
      sku: String(row['sku']),
      name: String(row['name']),
      description: row['description'] != null ? String(row['description']) : null,
      price: Number(row['price']),
      currency: String(row['currency']),
      stock: Number(row['stock']),
      status: row['status'] as SemanticSearchRow['status'],
      metadata: (row['metadata'] ?? {}) as Record<string, unknown>,
      similarity: Number(row['similarity'] ?? 0),
      createdAt: (row['createdAt'] instanceof Date
        ? row['createdAt'].toISOString()
        : String(row['createdAt'] ?? '')),
      updatedAt: (row['updatedAt'] instanceof Date
        ? row['updatedAt'].toISOString()
        : String(row['updatedAt'] ?? '')),
    };
  }

  // ---- Utils: pgvector string encoding --------------------------------------

  /** number[] → pgvector 호환 문자열 `[0.1,0.2,...]` */
  static encodeVector(embedding: number[]): string {
    return '[' + embedding.map(String).join(',') + ']';
  }

  /** pgvector 문자열 `[0.1,0.2,...]` → number[] */
  static decodeVector(raw: string | number[] | unknown): number[] | null {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.startsWith('[')) {
      try { return JSON.parse(raw) as number[]; } catch { return null; }
    }
    return null;
  }

  // ---- cosine 의미론 검색 ---------------------------------------------------

  async semanticSearch(
    embedding: number[],
    topK: number,
  ): Promise<SemanticSearchRow[]> {
    const vectorStr = ProductVectorRepository.encodeVector(embedding);
    const sql = /* sql */ `
      SELECT id, uuid, sku, name, description,
             price::float8              AS "price",
             currency, stock, status,
             metadata,
             created_at                 AS "createdAt",
             updated_at                 AS "updatedAt",
             1 - (embedding <=> $1::vector) AS similarity
      FROM products
      WHERE status = 'ACTIVE'
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `;
    const result = await this.pool.query(sql, [vectorStr, topK]);
    return result.rows.map((r) => this.mapRow(r));
  }

  // ---- pg_trgm 키워드 폴백 ---------------------------------------------------

  async trgmSearch(query: string, topK: number): Promise<SemanticSearchRow[]> {
    const sql = /* sql */ `
      SELECT id, uuid, sku, name, description,
             price::float8              AS "price",
             currency, stock, status,
             metadata,
             created_at                 AS "createdAt",
             updated_at                 AS "updatedAt",
             similarity(COALESCE(name, '') || ' ' || COALESCE(description, ''), $1) AS similarity
      FROM products
      WHERE status = 'ACTIVE'
        AND (COALESCE(name, '') || ' ' || COALESCE(description, '')) % $1
      ORDER BY similarity DESC
      LIMIT $2
    `;
    const result = await this.pool.query(sql, [query, topK]);
    return result.rows.map((r) => this.mapRow(r));
  }

  // ---- 상품 임베딩 조회 (추천: related 시드) ---------------------------------

  async getProductEmbedding(productId: number): Promise<number[] | null> {
    const sql = /* sql */ `
      SELECT embedding FROM products WHERE id = $1 AND embedding IS NOT NULL
    `;
    const result = await this.pool.query<{ embedding: unknown }>(sql, [productId]);
    return ProductVectorRepository.decodeVector(result.rows[0]?.embedding);
  }

  // ---- 복수 상품 조회 (추천: buildResults 용) ---------------------------------

  async getProductsByIds(productIds: number[]): Promise<SemanticSearchRow[]> {
    if (productIds.length === 0) return [];
    const sql = /* sql */ `
      SELECT id, uuid, sku, name, description,
             price::float8              AS "price",
             currency, stock, status,
             metadata,
             created_at                 AS "createdAt",
             updated_at                 AS "updatedAt"
      FROM products
      WHERE id = ANY ($1::bigint[])
        AND status = 'ACTIVE'
    `;
    const result = await this.pool.query(sql, [productIds]);
    return result.rows.map((r) => this.mapRow(r));
  }
}
