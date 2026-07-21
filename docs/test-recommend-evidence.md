# STEP 1. R 증거 4종 — 판정 기준표

## 증거 4종 개요

| # | 신호 | 산출식 | 범위 | 출처 |
|---|------|--------|------|------|
| S | semantic | `1 - cosine_distance(embedding, query)` | 0~1 | pgvector `<=>` |
| P | popularity | `LOG(view)*0.7 + LOG(sale)*0.3` → 정규화 (/8 cap) | 0~1 | `product_views` 테이블 |
| A | affinity | 선호 카테고리 일치=1, 불일치=0 | 0 or 1 | `metadata.category` |
| C | combined | `S·Ws + P·Wp + A·Wa` | 0~1 | 가중합 |

## 판정 기준표 (가중치)

| 시나리오 | W_semantic | W_popularity | W_affinity | dominant |
|----------|-----------|-------------|-----------|----------|
| **개인화** (personalized) | 0.5 | 0.3 | 0.2 | S+P |
| **콜드스타트-사용자** | 0.0 | 0.8 | 0.2 | P |
| **콜드스타트-상품** | 0.9 | 0.1 | 0.0 | S |

> `recommend.config.ts:2-12` — `RecommendConfig.WEIGHTS` / `.COLD_START`

## STEP 2. 결정론 — 같은 입력, 같은 출력 ✅

```bash
UUID="550e8400-e29b-41d4-a716-446655440000"
R1=$(curl -s "http://localhost:3000/api/recommend/home?userId=$UUID&topK=5" | jq -c 'del(.tookMs)')
R2=$(curl -s "http://localhost:3000/api/recommend/home?userId=$UUID&topK=5" | jq -c 'del(.tookMs)')
[ "$R1" = "$R2" ] && echo "PASS" || echo "FAIL"
```
- DummyEmbeddingProvider = SHA-256 결정론
- popularity = 정적 seed data
- reason = 규칙 기반 template

## STEP 3. 살아있는 캐시 + 무효화 ✅

```bash
# cache hit (<5ms)
curl -s -w '%{time_total}s\n' -o /dev/null "http://localhost:3000/api/recommend/home?userId=..."

# invalidate
curl -s -X POST "http://localhost:3000/api/recommend/invalidate-home" \
  -H "Content-Type: application/json" -d '{"userId":"..."}'

# recompute (tookMs > 0)
curl -s "http://localhost:3000/api/recommend/home?userId=..." | jq '.tookMs'
```

## STEP 4. 콜드스타트 분기 ✅

| 분기 | 조건 | source 값 | 검증 |
|------|------|-----------|------|
| 사용자 콜드스타트 | `getUserProfile()` → null | `cold_start_user` | `/recommend/home?userId=<임의>` |
| 상품 콜드스타트 | embedding 없음 / 유사상품 0건 | `cold_start_product` | `/recommend/related?productId=999` |
| 개인화 | profile + embedding 존재 | `personalized` | `/recommend/related?productId=1` |

> 현재 `getUserProfile()`은 항상 null → `/recommend/home`은 항상 cold_start_user

## sigmoid 판정 로직 (reason 생성)

`reason.service.ts:42-79` — 지배 신호 우선순위:

1. S > 0 **AND** P > 0.1 → `SEMANTIC_POPULAR_MIX`
2. S > 0 (지배) → `SEMANTIC_SIMILAR`
3. P > 0 (지배) → `POPULAR_TOP`
4. A > 0 (지배) → `AFFINITY_CATEGORY`
5. default → `POPULAR_TOP` (fallback)

## curl 검증 (현재 상태)

```bash
# === 증거 S+P (related — semantic + popularity) ===
curl -s "http://localhost:3000/api/recommend/related?productId=1&topK=5" \
  | jq '[.items[] | {name, signals}]'

# === 증거 P (cold_start_user — popularity only) ===
curl -s "http://localhost:3000/api/recommend/home?userId=$(uuidgen)&topK=5" \
  | jq '{source, signals: [.items[]?.signals]}'

# === 증거 A — 미구현 (getUserProfile() returns null) ===
# 프로필 연동 시 affinity=1 확인 가능: preferredCategory 일치 상품

# === 증거 C (combined — 모든 응답 items[].signals.combined) ===
curl -s "http://localhost:3000/api/recommend/home?userId=$(uuidgen)&topK=3" \
  | jq '[.items[] | {name, combined: .signals.combined}]'
```

## 버그 수정 (2026-07-22)

- `popularity.repository.ts` — `getScores()` / `getTopPopular()`: pg bigint→string 반환값을 `Number()`로 변환 (Map key lookup 실패로 popularity=0 버그)

## 검증 체크리스트

- [x] S: `/recommend/related` → `items[].signals.semantic > 0` (벡터 유사도)
- [x] P: `/recommend/home` cold_start → `items[].signals.popularity > 0` (예: 0.297)
- [ ] A: `getUserProfile()` 구현 전까지 항상 0 → skip
- [x] C: 모든 응답에서 `combined = S*Ws + P*Wp + A*Wa` 검증됨
