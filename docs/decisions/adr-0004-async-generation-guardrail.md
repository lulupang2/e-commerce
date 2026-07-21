# ADR-0004: 비동기 AI 생성 + 가드레일

**상태**: accepted
**날짜**: 2026-07-22

## 컨텍스트

LLM 기반 상품 설명·마케팅 문구 생성은 지연 시간(2~30초), 외부 API 비용, 할루시네이션 리스크가 있다. 동기 HTTP 응답에 LLM 호출을 포함하면 타임아웃과 장애를 전파한다.

## 결정

1. **비동기 이벤트**: product.created / review.accumulated → Redis Stream(`ai:events`) → ai-gen consumer가 XREADGROUP으로 소비. 생성 결과는 DB에 비동기 적재, 클라이언트는 polling 또는 null-tolerant.
2. **Consumer group**: XREADGROUP + XACK — 미확인(pending) 메시지는 XPENDING → XCLAIM으로 재할당. 최대 5회 재시도, 초과 시 DLQ(`ai:dlq`).
3. **멱등 3단계**:
   - Producer: Redis `SETNX ai:dedup:stream:{streamId}` (TTL 24h)
   - Consumer: `findBySourceEventId()` → 이미 처리된 이벤트 스킵
   - DB: `generated_contents(source_event_id, content_type) UNIQUE` → 중복 INSERT 거부
4. **가드레일 3종**:

   | 가드레일 | 메커니즘 | 실패 시 |
   |----------|----------|---------|
   | 유효성 | `GeneratedContentSchema`(Zod) 강제 — 필수필드·길이·금지어(`BANNED_WORDS`) | `status=rejected` + `rejectionReason` |
   | 비용 | `ai:budget:{tenant}:{YYYYMM}` INCRBY, 일일 500K 토큰 한도. 입력 해시 dedup(1h TTL)으로 동일 prompt 재생성 방지 | `status=rejected` + `needs_human_review=true` |
   | 폴백 | `rejected` 상태는 `needs_human_review=true` — 노출 경로는 `WHERE status='published'` 만 | 절대 published 되지 않음 |

5. **상태 머신**: `draft → verified → published / rejected`. `verified_at` 컬럼으로 실제 검증 통과 여부를 영속 (skip vs verify 판별).
6. **GenerationProvider 추상화**: `EmbeddingProvider`와 동일 패턴 — `DummyGenerationProvider`(SHA-256 결정론, 테스트), `HttpGenerationProvider`(env 기반 OpenAI 호환).

## 결과

- ai-gen 서비스: Redis Stream consumer + HTTP `/health`(pg/redis/consumer 생존)
- 생성물 영속: `generated_contents` 테이블 (UNIQUE 멱등, verified_at 추적)
- development: DummyProvider로 실제 LLM API 없이 검증

## 검증

| 항목 | 결과 |
|------|------|
| Stream → consumer → DB | XADD → 6s → `status=published, verified_at=SET, token_count=89` |
| 가드레일 - 유효성 | 금지어/스키마 위반 → `status=rejected, needs_human_review=true` |
| 가드레일 - 비용 | 입력 중복 감지 → `Skipping duplicate input` 로그, token_count 0 |
| 멱등 (eventId 2회) | `SELECT count(*) WHERE source_event_id=$1` → 1 |
| NOGROUP 복구 | FLUSHALL 후 consumer가 자동 재생성 (`NOGROUP` → `XGROUP CREATE MKSTREAM`) |
| tsc --noEmit | PASS (0 errors) |

## 정직 기록

- **89 tokens**: DummyProvider의 `GuardrailService.estimateTokens()` — `text.length / 4` 길이 기반 추정. 실제 LLM 연동 시 API 응답의 `usage.total_tokens`으로 교체 필요.
- **verified_at 정직성**: published가 verified를 경유했는지 여부는 `verified_at IS NOT NULL`로 판별. 단, 현재 로직은 verified와 published를 연속 호출하므로 항상 SET임. 향후 수동 승인 단계 추가 시 `verified_at` + `published_at` 분리.
- **producer 부재**: `apps/api`는 아직 이벤트 producer(XADD)가 없음 — 현재 seed 스크립트에서만 발행 가능. product/order 도메인이 분리될 때 producer가 추가될 예정.
- **DLQ 모니터링**: `ai:dlq` 스트림에 쌓인 메시지는 현재 자동 알림 없음 — 수동 `XLEN ai:dlq` 확인 필요.
