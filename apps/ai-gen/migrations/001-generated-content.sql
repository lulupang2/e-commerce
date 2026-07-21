-- migrations 003: generated_content 테이블 (비동기 AI 생성 파이프라인)
--   source_event_id + content_type UNIQUE → 멱등 보장
--   status 상태머신: draft → verified → published / rejected

CREATE TABLE IF NOT EXISTS generated_contents (
  id              BIGSERIAL PRIMARY KEY,
  content_key     VARCHAR(100) NOT NULL,
  source_event_id UUID NOT NULL,
  aggregate_id    VARCHAR(100) NOT NULL,
  content_type    VARCHAR(50) NOT NULL,
  raw_output      JSONB NOT NULL DEFAULT '{}',
  validated       JSONB,
  status          VARCHAR(20) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'verified', 'published', 'rejected')),
  rejection_reason TEXT,
  needs_human_review BOOLEAN NOT NULL DEFAULT FALSE,
  token_count     INTEGER NOT NULL DEFAULT 0,
  provider        VARCHAR(50) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_event_id, content_type)
);

COMMENT ON TABLE generated_contents IS 'AI 생성 콘텐츠 — Redis Stream 이벤트 기반 비동기 생성 결과';
COMMENT ON COLUMN generated_contents.source_event_id IS '멱등 키: 동일 이벤트+타입은 1건만 생성';
COMMENT ON COLUMN generated_contents.validated IS 'Zod 검증 통과한 정제물 (NULL → 검증 전/실패)';
