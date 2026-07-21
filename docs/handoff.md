# Handoff — 2026-07-22

## 진행 상태

- [x] `/api/recommend/home` 200 확인
- [x] `/api/search` 200 확인
- [x] `/api/recommend/related` 200 확인
- [ ] `/api/recommend/invalidate-home` 미검증
- [ ] `getUserProfile()` 콜드스타트 TODO (항상 null → popularity만)

## 이번 세션 변경사항

### 1. `@swc/core` 의존성 추가 (pnpm-workspace root)
- **이유**: `tsx` 기본 엔진인 esbuild가 `experimentalDecorators` / `emitDecoratorMetadata` 미지원
- tsx는 `@swc/core`가 있으면 자동으로 SWC 사용
- `.swcrc` 파일 추가 (decoratorMetadata, legacyDecorator 설정)

### 2. 컨트롤러 `@Inject()` 명시
- `modules/search-rec/src/search.controller.ts:8` — `@Inject(SearchService)` 추가
- `modules/search-rec/src/recommend/recommend.controller.ts:16-17` — `@Inject(RecommendService)`, `@Inject(RecommendCacheService)` 추가
- **이유**: `emitDecoratorMetadata` 미방출 환경에서 NestJS DI가 생성자 파라미터 타입을 추론하지 못 함

### 3. `ProductVectorRepository.mapRow()` 타입 변환
- `modules/search-rec/src/product-vector.repository.ts:34-54` — private `mapRow()` 추가
- node-postgres가 bigint→string, timestamp→Date로 반환하는 것을 Zod 스키마 기대 타입(number, ISO string)으로 변환
- `semanticSearch()`, `trgmSearch()`, `getProductsByIds()` 세 메서드 모두 `mapRow` 경유

### 4. `PopularityRepository` bigint→number 변환
- `modules/search-rec/src/recommend/popularity.repository.ts:28-29` — `getScores()`: `Number(row.product_id)` 추가
- 동일 파일 `getTopPopular()`: `Number(r.product_id)` 추가
- Map key가 string으로 설정되어 Number lookup 실패 → popularity 항상 0 버그

### 5. Redis 캐시 플러시
- 이전 실행에서 잘못된 형식의 응답이 캐시되어 500 반복 → `FLUSHALL`로 해결

## 주의사항

- `tsx` CLI 사용 시 반드시 `@swc/core` 설치 필요 (없으면 `experimentalDecorators` 오류)
- `pnpm approve-builds @swc/core` 실행 후 `pnpm i` 필요
- 서버는 `pnpm exec tsx apps/api/src/main.ts` 로 실행 (3000번)
- 컨트롤러에 `@Inject()` 필수 — 향후 새 컨트롤러 추가 시 동일 패턴 적용
