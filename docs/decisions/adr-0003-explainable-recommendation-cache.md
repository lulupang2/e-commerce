# ADR-0003: 설명 가능한 추천 + 캐시

**상태**: accepted
**날짜**: 2026-07-22

## 컨텍스트

추천 시스템은 단순히 상품을 나열하는 것을 넘어, 왜 이 상품이 추천되었는지 이유(reason)와 각 신호의 기여도(signals)를 투명하게 공개해야 한다. 또한 신호 재계산은 비용이 크므로 캐싱과 선별적 무효화가 필요하다.

## 결정

1. **4신호 모델**: `semantic`(벡터 유사도, 0~1), `popularity`(LOG(view)*0.7 + LOG(sale)*0.3 정규화, 0~1), `affinity`(선호 카테고리 일치=1 불일치=0), `combined`(가중합).
2. **시나리오별 가중치** (`recommend.config.ts`):

   | 시나리오 | W_semantic | W_popularity | W_affinity |
   |----------|:---:|:---:|:---:|
   | 개인화 | 0.5 | 0.3 | 0.2 |
   | 콜드스타트-사용자 | **0** | **0.8** | 0.2 |
   | 콜드스타트-상품 | **0.9** | 0.1 | **0** |

3. **결정론**: SHA-256 기반 `DummyEmbeddingProvider` + 규칙 기반 `ReasonService` — 동일 입력 = 동일 출력 (tookMs 제외 diff=0).
4. **reason 생성**: 지배 신호 판정 → 템플릿 매핑 (`SEMANTIC_SIMILAR` / `POPULAR_TOP` / `AFFINITY_CATEGORY` / `SEMANTIC_POPULAR_MIX`), 콜드스타트 전용 템플릿 분리.
5. **캐시 무효화**: `POST /recommend/invalidate-home` → Redis `rec:signalv:{userId}` INCR → 캐시 키 변경으로 무효화. `GET /recommend/home` 시 `signalVersion` 비교로 재계산.
6. **콜드스타트 분기**: `getUserProfile()` null → `source=cold_start_user` (popularity 전용). embedding 없는 상품 → `source=cold_start_product` (인기도 폴백).

## 결과

- 추천 응답: `{items, source, tookMs}` + 각 아이템에 `{reason, signals}`
- 캐시 TTL: home=600s, related=3600s
- `/recommend/home`은 콜드스타트 경로(임의 UUID로 테스트 가능)

## 검증

| 항목 | 결과 |
|------|------|
| 결정론 | 동일 userId 2회 호출 → `diff <(jq -c 'del(.tookMs)' r1) <(jq -c 'del(.tookMs)' r2)` = 0 |
| 캐시 무효화 | cached 2ms → POST invalidate → recompute tookMs=4ms |
| 콜드스타트 분기 | `getUserProfile()` null → `source=cold_start_user`, embedding 없는 상품 → `cold_start_product`, 정상 → `personalized` |
| popularity 신호 | cold_start_home → `items[].signals.popularity ≈ 0.28~0.30` (raw score 2.0~2.4/8) |
| bigint→number 변환 | `PopularityRepository.getScores()`·`getTopPopular()`에서 `Number(row.product_id)` — 미적용 시 popularity=0 버그 (Map key lookup 실패) |

## 정직 기록

- **affinity 미동작**: `getUserProfile()` → 항상 null (TODO). 사용자 프로필 서비스 연동 전까지 affinity=0 고정. 이로 인해 `/recommend/home`은 항상 cold_start_user로 작동.
- **popularity 정규화**: `Math.min(1, score / 8)` — divisor 8은 히스토리컬 데이터에 맞춘 휴리스틱. 실제 운영 데이터로 recalibration 필요.
- **reason LLM 강화 미구현**: `LLmReasonProvider` 인터페이스 정의만 있고, ai-gen 서비스와 연동되어 있지 않음 (후속 과제).
