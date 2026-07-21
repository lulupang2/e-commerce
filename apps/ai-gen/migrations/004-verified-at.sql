-- migrations 004: verified_at 컬럼 추가 (가드레일 정직 기록 — skip vs verify 판별)
ALTER TABLE generated_contents ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
COMMENT ON COLUMN generated_contents.verified_at IS 'Zod 검증 통과 시각 (NULL=스킵 또는 검증 전, SET=verify 거친 published)';
