# ADR-0002: 벡터 검색 + 키워드 폴백

**상태**: accepted
**날짜**: 2026-07-22

## 컨텍스트

e커머스 검색은 단순 키워드 매칭을 넘어 의미론적 유사도가 필요하다. 하지만 벡터 검색은 "알래스카" 같은 입력에 취약하며, 폴백 없이는 검색 결과 0건이 사용자 경험을 해친다.

## 결정

1. **pgvector cosine(<=>) 연산자**: 정규화된 임베딩에서 cosine distance = 내적과 등가 — L2 distance 대비 차원 수에 덜 민감.
2. **HNSW 인덱스**: IVF-Flat 대비 근사 검색 정확도·속도 트레이드오프 우수 (읽기 워크로드에 적합).
3. **pg_trgm 키워드 폴백**: 벡터 검색 최대 유사도 < 임계치(0.7) → `similarity(name || desc, query)`의 `%` 연산자로 폴백. 예외 발생 시에도 동일 폴백 경로.
4. **EmbeddingProvider 추상화**: 검색 모듈이 임베딩 생성 방식을 모르도록 abstract class. 기본 = `DummyEmbeddingProvider`(SHA-256 결정론), 교체 = `HttpEmbeddingProvider`(OpenAI 호환). `SearchRecModule.forRoot({embeddingProvider})`로 주입.
5. **pgvector 타입 처리**: node-postgres는 JS 배열을 PG 배열 리터럴 `{0.1,0.2}`로 변환 — pgvector가 거부. `encodeVector()`로 `[0.1,0.2,...]` 문자열로 변환. `decodeVector()`로 역변환.
6. **Repository mapRow 패턴**: node-postgres가 bigint→string, timestamp→Date로 반환 → `ProductVectorRepository.mapRow()`가 Number/toISOString 변환. 모든 쿼리 결과는 이 헬퍼 경유.
7. **SWC 트랜스파일**: tsx 기본 esbuild는 `experimentalDecorators`/`emitDecoratorMetadata` 미지원 — `@swc/core` 설치로 SWC 자동 전환. NestJS DI 보완으로 컨트롤러 생성자에 `@Inject()` 명시.

## 결과

- 검색 2단계: 벡터 우선 → 실패 시 폴백 → 그래도 실패 시 에러 응답
- 로컬 개발은 DummyEmbeddingProvider(결정론, SHA-256)로 LLM API 없이 검증 가능
- `SearchCacheService`로 검색 결과 Redis 캐싱 (TTL 300s)

## 검증

| 항목 | 결과 |
|------|------|
| 벡터 검색 거리순 정렬 | `/api/search?q=무선` → trgm_fallback (max similarity < 0.7 → 폴백 로그 확인) |
| 폴백 로그 | `Vector similarity below threshold (max=0.1232 < 0.7), falling back to trgm` |
| 캐시 히트 | 동일 쿼리 2회 호출 → 2회차 tookMs=0 (캐시) |
| tsc --noEmit | PASS (SWC + @Inject 보완 후) |
| bigint/Date → Zod 호환 | `mapRow()` 반환값 → `z.number().int()` / `z.string().datetime()` 통과 |

## 정직 기록

- HNSW 인덱스는 `CREATE INDEX ... USING hnsw` 구문 사용. pgvector 0.5.0+ 필요 — `pgvector/pgvector:pg16` 이미지로 충족.
- `similarityThreshold` = 0.7은 휴리스틱 — 프로덕션에서는 A/B 테스트로 최적화 필요.
- `DummyEmbeddingProvider`의 벡터 정규화는 L2 norm — cosine distance = 1 - (v1·v2) 가정. 실제 cosine 유사도와는 정확히 일치하지 않으나 결정론 검증에는 충분.
