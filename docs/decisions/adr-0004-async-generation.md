# ADR-0004: 비동기 생성 + 가드레일

**날짜**: 2026-07-22
**상태**: accepted

## 통신 패턴

- **R(검색/추천)=동기, B(생성)=비동기 이벤트**. 원칙: "대기 필요=동기, 백그라운드=이벤트"
- Redis Stream + consumer group (XREADGROUP/XACK), 실패 시 pending 재소비
- producer(product/order) ↔ consumer(ai-gen)는 `shared/events.ts` 로만 소통, 직접 import 금지

## 가드레일 3종 (검증 2026-07-22)

| 가드레일 | 메커니즘 | 검증 결과 |
|----------|----------|-----------|
| **유효성** | `GeneratedContentSchema`(Zod) 강제 → 위반 시 `rejected` | 의도적 나쁜 입력: `rejected=1, needs_human_review=true` PASS |
| **비용** | 토큰 예산 체크 (`GuardrailService.checkBudget`) | 측정: 89 tokens (DummyProvider) |
| **폴백/검수** | 검증 실패분 `status=rejected` + `needs_human_review=true`, `published` 경로 차단 | `WHERE status='published'` 만 노출 |

## 멱등성

- `source_event_id UNIQUE` + eventId 중복 스킵
- 검증: 동일 eventId 2회 발행 → `count=1` (PASS)

## 정직 기록

- D의 `published` 가 verified 경유인지 스킵인지: `verified_at` 이력 컬럼 유무로 확인 필요.
  **검증 흔적이 영속되어야 가드레일 서사 완성.**
- 89 tokens는 DummyProvider 환경의 길이 기반 추정. 실제 LLM 연동 시 토큰 API 응답으로 교체 예정.
- affinity/getUserProfile TODO — B와는 독립, 별도 추적.
