# ADR-0001: 공유 스키마 SSOT (Zod 기반)

**상태**: accepted
**날짜**: 2026-07-22

## 컨텍스트

e커머스 MSA에서 여러 서비스가 상품·주문·이벤트·추천·생성물 계약을 공유해야 한다. 각 서비스가 자체 스키마를 정의하면 계약 불일치·중복·파편화가 발생한다.

## 결정

1. **단일 출처**: `packages/shared`(Zod)를 유일한 스키마 저장소로 — `@shared/schemas` 경로로 모든 서비스가 import.
2. **모듈 간 직접 import 금지**: 서비스 간 통신은 HTTP(동기 R)와 Redis Stream(비동기 B)만 — shared만 공유 예외.
3. **스키마 구성**:
   - `product.ts` — `ProductBaseSchema`(확장용), `ProductSchema`(superRefine — embedding 차원 검증), `ProductStatus`
   - `order.ts` — `OrderSchema`, `OrderItemSchema`, `OrderStatus`
   - `events.ts` — `BaseEventSchema`(schemaVersion/eventId/occurredAt/envelope), `ProductCreatedEvent`, `ReviewAccumulatedEvent`
   - `recommend.ts` — `RecommendSignals`, `RecommendResultItem`(ProductBaseSchema 확장), `RecommendResponse`
   - `generated-content.ts` — `GeneratedContentSchema`(필수필드·금지어·길이), `BANNED_WORDS`, `ContentStatusChangedEvent`
4. **불변식**: Zod refine로 도메인 규칙 강제 — price≥0, stock≥0, 통화 ISO-4217(3자 대문자), embedding 차원=PGVECTOR_DIM.
5. **스키마 진화**: `BaseEventSchema.schemaVersion`(semver)로 하위호환 판정. 신규 필드는 optional 추가, 제거는 새 MAJOR 버전.

## 결과

- 모든 서비스가 `@shared/schemas` 하나로 계약 일관성 확보
- Zod `safeParse`로 런타임 검증 — 잘못된 데이터는 서비스 진입 전 차단
- `ProductBaseSchema`는 `.extend()` 가능 (추천·검색 확장), `ProductSchema`는 불변

## 검증

| 항목 | 결과 |
|------|------|
| tsc --noEmit | PASS (0 errors) |
| 음수 가격 Zod 거부 | `ProductBaseSchema.parse({price:-100,...})` → ZodError |
| 직접 import 금지 | `grep -rn "from '@(search\|ai)/" apps/api/src/` → 0건 |
| shared 단일 정의 | `GeneratedContentSchema`·`ProductSchema` 등 모든 스키마 `packages/shared` 1개소만 정의 |

## 정직 기록

- `getUserProfile()` TODO — 추천 affinity 신호가 항상 0 (ADR-0003 참조). 사용자 프로필 서비스 분리 시 `@shared/schemas`에 UserProfile 스키마 추가 예정.
- `events.ts`의 `EVENT_NAMES` 상수는 현재 2개 — 신규 이벤트 추가 시 이 파일 하나만 수정하면 모든 producer/consumer에 전파.
