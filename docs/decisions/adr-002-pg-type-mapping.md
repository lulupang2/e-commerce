# ADR-002: Repository 레이어 pg → JS 타입 변환

**날짜**: 2026-07-22
**상태**: accepted

## 배경

node-postgres는 PostgreSQL 타입을 다음처럼 변환한다:

| PG Type | JS Type | Zod 기대 |
|---------|---------|----------|
| `bigint` | `string` | `z.number()` |
| `timestamp` | `Date` | `z.string().datetime()` |

이로 인해 Zod 응답 검증이 실패하고 500 오류 발생.

## 결정

1. `ProductVectorRepository`에 private `mapRow()` 헬퍼 추가 — 모든 쿼리 결과를 SemanticSearchRow 타입으로 정규화
2. `PopularityRepository.getScores()` — `Number(row.product_id)`로 Map key 변환
3. `PopularityRepository.getTopPopular()` — `Number(r.product_id)`로 ID 배열 변환

## 대안

- node-postgres type parser 설정 — pg 전역 설정 변경은 다른 모듈에 영향 가능, 명시적 변환보다 취약
- Zod 스키마 확장 (`z.coerce.number()` 등) — 스키마가 DB 구현 디테일에 오염됨
- ORM 도입 — 현재 아키텍처는 raw SQL 기반

## 결과

- 모든 `GET` 엔드포인트에서 Zod 검증 통과
- 향후 신규 쿼리 추가 시 `mapRow()` 패턴 유지
