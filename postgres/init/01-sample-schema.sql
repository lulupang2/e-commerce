-- ============================================================
-- 01-sample-schema.sql
-- e커머스 상품 + 하이브리드 검색(pgvector + pg_trgm) 예시 스키마
-- ============================================================

CREATE TABLE IF NOT EXISTS products (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid        UUID        NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    sku         TEXT        NOT NULL UNIQUE,
    name        TEXT        NOT NULL,
    description TEXT,
    price       NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
    currency    CHAR(3)     NOT NULL DEFAULT 'KRW',
    stock       INTEGER     NOT NULL DEFAULT 0 CHECK (stock >= 0),
    status      TEXT        NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('DRAFT', 'ACTIVE', 'SOLD_OUT', 'ARCHIVED')),
    -- pgvector: 임베딩 (예: OpenAI text-embedding-3-small = 1536)
    embedding   vector(1536),
    metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_status     ON products (status);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_metadata_gin ON products USING gin (metadata);

-- 키워드 폴백: pg_trgm GIN (유사도 / ILIKE 가속)
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
    ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_desc_trgm
    ON products USING gin (description gin_trgm_ops);

-- 의미론 검색: HNSW (cosine)
CREATE INDEX IF NOT EXISTS idx_products_embedding_hnsw
    ON products USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_set_updated_at ON products;
CREATE TRIGGER products_set_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION trg_set_updated_at();

-- ============================================================
-- 하이브리드 검색 함수: 벡터 유사도 + 키워드 폴백 RRF fusion
--   $1: query_embedding  $2: keyword $3: limit
-- ============================================================
CREATE OR REPLACE FUNCTION search_products_hybrid(
    q_embedding vector(1536),
    q_keyword   TEXT,
    q_limit     INT DEFAULT 20
) RETURNS TABLE (
    id          BIGINT,
    name        TEXT,
    score       DOUBLE PRECISION
) LANGUAGE sql STABLE AS $$
    WITH semantic AS (
        SELECT id, name,
               ROW_NUMBER() OVER (ORDER BY embedding <=> q_embedding) AS s_rank
        FROM products
        WHERE status = 'ACTIVE' AND embedding IS NOT NULL
        ORDER BY embedding <=> q_embedding
        LIMIT q_limit
    ), lexical AS (
        SELECT id, name,
               ROW_NUMBER() OVER (ORDER BY similarity(
                   COALESCE(name,'') || ' ' || COALESCE(description,''),
                   q_keyword
               ) DESC) AS l_rank
        FROM products
        WHERE status = 'ACTIVE'
          AND (COALESCE(name,'') || ' ' || COALESCE(description,'')) % q_keyword
        LIMIT q_limit
    )
    SELECT COALESCE(s.id, l.id)             AS id,
           COALESCE(s.name, l.name)         AS name,
           -- Reciprocal Rank Fusion (k=60)
           COALESCE(1.0 / (60 + s.s_rank), 0.0)
         + COALESCE(1.0 / (60 + l.l_rank), 0.0) AS score
    FROM semantic s
    FULL OUTER JOIN lexical l USING (id)
    ORDER BY score DESC
    LIMIT q_limit;
$$;