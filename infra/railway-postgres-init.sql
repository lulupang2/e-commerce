-- Railway Postgres 초기화: pgvector + pg_trgm 확장 (서비스 최초 생성 시 1회 실행)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
