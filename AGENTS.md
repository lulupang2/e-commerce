# AGENTS.md — e커머스 MSA 포트폴리오

pnpm workspace monorepo. Postgres + pgvector + Redis infra, NestJS API, Zod SSOT.
이 저장소는 **OpenCode 에이전트로 제작**됨 — 아래 "운영 규칙"을 먼저 읽을 것.

## 운영 규칙 (에이전트 필독)

- 산출물 SSOT = **코드 + `docs/decisions/`(ADR) + git**. AI 대화 히스토리에 의존하지 말 것. 진행 상태(멈춘 지점·미검증 항목)는 `docs/handoff.md`에 유지.
- 도메인 스키마·이벤트 계약의 SSOT는 `packages/shared`(Zod). 모든 모듈은 `@shared/schemas`만 import, **모듈 간 직접 import 금지**(순환 의존 차단).
- **커스텀 에이전트는 `opencode.json` 최상위 `agents` 키로 정의 불가**(검증됨: `Unrecognized key: agents`). 마크다운 에이전트 파일로 정의할 것.
- 역할별 모델 라우팅: 설계/아키텍처 = 추론 강한 모델, 구현 = 코딩 모델, 리뷰 = 코드 특화 모델. 모델 ID는 `/models` 실제 목록 기준(추측 금지).
- **자동 수정 루프**: 코드 변경 후 bash로 직접 실행·검증할 것("확인해보세요" 금지). 성공조건 + 반복 상한(같은 에러 3회)을 명시하고, 외부 입력/판단 필요 시에만 보고.
- AI 생성물은 **`git diff`로 인간이 검수·채택·기각 후 커밋**. 맹신 금지.

## 필수 명령어

```bash
pnpm i                          # 모든 워크스페이스 설치 (pnpm 고정)
pnpm exec tsc --noEmit          # 전체 타입 체크

# 인프라
cd infra && cp .env.example .env && docker compose up -d
docker compose ps               # (healthy) 표시까지 대기

# 마이그레이션 (psql 미설치 — docker exec 사용)
docker exec -i portfolio-postgres psql -U portfolio -d portfolio \
  < modules/search-rec/migrations/002-product-views.sql

# 시드 (마이그레이션 먼저!)
DATABASE_URL="postgresql://portfolio:change-me@localhost:5432/portfolio" \
  pnpm --filter @search/search-rec seed

# API 서버
pnpm --filter @portfolio/api start:dev
```

## 워크스페이스 구성

```
packages/shared/      @shared/schemas       Zod SSOT (Product, Order, Event, Recommend)
modules/search-rec/   @search/search-rec    NestJS 모듈: 의미론 검색 + 추천
apps/api/             @portfolio/api        NestJS 앱 진입점 (search-rec 모듈 임포트)
infra/                docker-compose        pgvector/pgvector:pg16 + redis:7-alpine
postgres/init/        init SQL              컨테이너 최초 생성 시 자동 실행
```

- **패키지 매니저는 pnpm 고정.** `npm install`/`npx`는 `workspace:*` 프로토콜을 해석 못 해 `EUNSUPPORTEDPROTOCOL`로 실패함. `pnpm --filter <pkg>`, `pnpm exec`만 사용.
- `pnpm-workspace.yaml`이 **유일한** 워크스페이스 설정 파일. 루트 `package.json`의 `workspaces` 필드는 pnpm이 무시함(WARN).
- `pnpm --filter <패키지명>`으로 특정 패키지 대상 지정.

## 경로 별칭 (tsconfig.json)

```ts
import { ProductBaseSchema } from '@shared/schemas';    // → packages/shared/src/index.ts
import { SearchRecModule }   from '@search/search-rec'; // → modules/search-rec/src/index.ts
```

런타임 해석은 `tsx`가 처리. 개발 환경에서 별도 빌드 불필요.

## TypeScript / NestJS

- 루트 `tsconfig.json`에 `experimentalDecorators`, `emitDecoratorMetadata` (모든 패키지 상속).
- `@nestjs/cli` 미사용. `tsx watch src/main.ts`가 `@portfolio/api`의 개발 서버 실행기(`start:dev`).

## LF 줄바꿈 강제

`.editorconfig` + `.gitattributes`가 `eol=lf` 강제. **CRLF가 섞이면 Docker init SQL 진입점 스크립트가 실행되지 않음.** 확인: `grep -rlc $'\r' <경로>`.

## pgvector: 벡터 형식 함정

`$1::vector` 캐스트는 node-postgres가 JS 배열에서 만드는 PG 배열 리터럴 `{0.1,0.2}`를 **거부**함. 반드시 문자열로:

```ts
// ✅ 올바름
const vec = '[' + embedding.map(String).join(',') + ']';
await pool.query('SELECT ... WHERE embedding <=> $1::vector', [vec]);

// ❌ 깨짐 — pgvector가 {0.1,0.2,...} 거부
await pool.query('SELECT ... WHERE embedding <=> $1::vector', [embedding]);
```

변환은 `ProductVectorRepository.encodeVector()` / `.decodeVector()` 사용. 시드 등 외부에서 벡터를 다룰 때도 이 헬퍼에 의존.

## Zod: ProductBaseSchema vs ProductSchema

`ProductSchema`는 `ProductBaseSchema.superRefine(...)`로 만든 `ZodEffects`라 **`.extend()` 불가**.

```ts
// ✅ 확장 필요 시 기본 스키마 사용
import { ProductBaseSchema } from '@shared/schemas';
const Extended = ProductBaseSchema.extend({ similarity: z.number() });

// ❌ ProductSchema.extend() → TS 오류
```

둘 다 `@shared/schemas`에서 export. `.superRefine()`은 임베딩 차원만 검사하므로, 임베딩 없는 스키마가 ProductBase를 확장해도 무방.

## 인프라 포트 & 비밀번호

`infra/.env`의 `PG_PORT`가 **호스트 포트** 결정(컨테이너 내부는 항상 5432). 호스트 포트가 바뀌면 `DATABASE_URL`도 같은 포트여야 함.

```bash
docker compose -f infra/docker-compose.yml ps   # 실제 호스트:컨테이너 매핑
cat infra/.env | grep PASSWORD                   # 실제 비밀번호
```

비밀번호에 `#`이 있으면 `DATABASE_URL`에서 `%23`으로 URL 인코딩 + 셸 따옴표:
`DATABASE_URL="postgresql://user:pass%23word@host/db"`.

`.env` 변경 후 재생성(데이터 소실 주의): `docker compose down -v && docker compose up -d`.

## DB 스키마 주의

- `products.stock`은 시드 INSERT에 포함. 이전 버전으로 초기화된 컨테이너면 수동 추가:
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0;`
- `product_views`는 init SQL이 아닌 **search-rec 마이그레이션**으로 생성 → 시드 전에 마이그레이션 먼저.
- 모든 SQL은 파라미터 바인딩(`$1`, `$2`, `ANY($1::bigint[])`)만. 템플릿 리터럴 보간 금지.

## EmbeddingProvider 선택

`SearchRecModule.forRoot()`에 선택적으로 `embeddingProvider` 전달. 기본 = `DummyEmbeddingProvider`(SHA-256 → 결정론적 벡터). 프로덕션:

```ts
import { createHttpEmbeddingProvider } from '@search/search-rec';
SearchRecModule.forRoot({ pgPool, redis, embeddingProvider: createHttpEmbeddingProvider() });
```

`createHttpEmbeddingProvider`는 `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL` 환경변수를 읽음.

## pnpm 빌드 승인 (onlyBuiltDependencies)

`pnpm-workspace.yaml`의 `onlyBuiltDependencies`(또는 루트 `package.json`의 `pnpm.onlyBuiltDependencies`)에 네이티브 빌드 스크립트 패키지(대표: **`esbuild`**)를 등록해야 함. 미등록 시 `ERR_PNPM_IGNORED_BUILDS`로 `pnpm exec`/`pnpm i` 실패. 차단되면 `pnpm approve-builds` 대화형 실행 후 `pnpm i` 재실행.

## API 엔드포인트 (`start:dev` 후)

```
GET  /api/search?q=무선이어폰&topK=5
GET  /api/recommend/home?userId=<uuid>&topK=10
GET  /api/recommend/related?productId=1&topK=6
POST /api/recommend/invalidate-home  {"userId":"..."}
```

## 콜드스타트 참고

`RecommendService.getUserProfile()`은 무조건 `null` 반환(TODO). 따라서 `/recommend/home`은 **항상 콜드스타트 경로(popularity만)** 로 동작하며, 사용자 프로필 서비스 연동 전까지 affinity 신호는 동작 안 함. 콜드스타트 경로는 임의 UUID로 테스트 가능.