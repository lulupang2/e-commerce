-- ============================================================
-- 00-init-extensions.sql
-- pgvector(의미론 검색) + pg_trgm(키워드 폴백) + 보조 확장
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pg_trgm 기본 한계값 (LIKE/ILIKE 폴백 성능)
SET pg_trgm.similarity_threshold = 0.3;

-- 디버그용: 현재 확장 상태
SELECT extname, extversion FROM pg_extension ORDER BY extname;