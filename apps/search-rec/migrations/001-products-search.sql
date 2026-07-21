-- ============================================================
-- 001-products-search.sql
-- search-rec 모듈 마이그레이션: embedding 컬럼 + HNSW 인덱스 + trgm 인덱스
-- (additive only: IF NOT EXISTS 로 멱등 보장, pg16 이상)
-- ============================================================

-- embedding 컬럼 (기존 products 테이블에 추가)
-- 차원은 packages/shared/src/schemas/product.ts 의 PGVECTOR_DIM 와 일치해야 함 (현재 1536)
ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- HNSW 인덱스: cosine distance 기반 벡터 검색 가속
-- (소규모 포트폴리오 기준: m=16, ef_construction=64)
CREATE INDEX IF NOT EXISTS idx_products_embedding_hnsw
  ON products USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- pg_trgm GIN 인덱스: 키워드 폴백용 name 유사도 검색
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING gin (name gin_trgm_ops);

-- pg_trgm GIN 인덱스: 키워드 폴백용 description 유사도 검색
CREATE INDEX IF NOT EXISTS idx_products_desc_trgm
  ON products USING gin (description gin_trgm_ops);
