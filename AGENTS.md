# AGENTS.md — e커머스 MSA 포트폴리오

pnpm workspace monorepo. Postgres + pgvector + Redis(Stream) infra, NestJS 서비스 3개, Zod SSOT.
이 저장소는 **OpenCode 에이전트로 제작**됨 — 아래 "운영 규칙"을 먼저 읽을 것.

## 운영 규칙 (에이전트 필독)

- 산출물 SSOT = **코드 + `docs/decisions/`(ADR) + git**. AI 대화 히스토리에 의존하지 말 것. 진행 상태(멈춘 지점·미검증 항목)는 `docs/handoff.md`에 유지.
- 도메인 스키마·이벤트 계약의 SSOT는 `packages/shared`(Zod). **서비스 간 직접 import 금지** — 통신은 HTTP(동기 R) 또는 Redis Stream 이벤트(비동기 B)만. shared만 공유.
- **커스텀 에이전트는 `opencode.json` 최상위 `agents` 키로 정의 불가**(검증됨: `Unrecognized key: agents`). 마크다운 에이전트 파일로 정의할 것.
- 역할별 모델 라우팅: 설계/아키텍처 = 추론 강한 모델, 구현 = 코딩 모델, 리뷰 = 코드 특화 모델. 모델 ID는 `/models` 실제 목록 기준(추측 금지).
- **자동 수정 루프**: 코드 변경 후 bash로 직접 실행·검증할 것("확인핳보세요" 금지). 성공조건 + 반복 상한(같은 에러 3회)을 명시하고, 외부 입력/판단 필요 시에만 보고.
- AI 생성물은 **`git diff`로 인간이 검수·채택·기각 후 커밋**. 맹신 금지.

## 아키텍처 (ADR-0005 — 모듈식 모놀리스 → MSA 1단계 완료)

```
클라이언트 → apps/api (BFF :3000) ──HTTP──► apps/search-rec (:3001)
                                    └─XADD─► Redis Stream ─► apps/ai-gen (consumer, :3002 /health)
```

- **R(검색/추천) = 동기 HTTP**: apps/api는 search-rec를 `SEARCH_REC_URL`로 HTTP 호출(프록시). 직접 import 0.
- **B(생성) = 비동기 이벤트**: ai-gen은 Redis Stream(`ai:events`) consumer. producer는 현재 seed 스크립트(apps/api producer는 후속 과제).
- 추출 기준표·나머지 도메인(product/order)을 안 뺀 근거는 `docs/decisions/adr-0005-modular-monolith-to-msa.md` 참조.

## 필수 명령어

```bash
pnpm i                          # 모든 워크스페이스 설치 (pnpm 고정)
pnpm exec tsc --noEmit          # 전체 타입 체크

# 인프라
cd infra && cp .env.example .env && docker compose up -d
docker compose ps               # (healthy) 표시까지 대기

# 마이그레이션 (psql 미설치 — docker exec 사용)
docker exec -i portfolio-postgres psql -U portfolio -d portfolio \
  < apps/search-rec/migrations/002-product-views.sql
docker exec -i portfolio-postgres psql -U portfolio -d portfolio \
  < apps/ai-gen/migrations/001-generated-content.sql
docker exec -i portfolio-postgres psql -U portfolio -d portfolio \
  < apps/ai-gen/migrations/004-verified-at.sql

# 시드 (마이그레이션 먼저!)
DATABASE_URL="postgresql://portfolio:change-me@localhost:5432/portfolio" \
  pnpm --filter @search/search-rec-app seed

# 로컬 개발: 서비스 3개 각각 기동 (포트 3000/3001/3002)
PORT=3001 pnpm --filter @search/search-rec-app start:dev   # search-rec
PORT=3002 pnpm --filter @ai/ai-gen-app start:dev           # ai-gen (consumer)
PORT=3000 SEARCH_REC_URL=http://localhost:3001 \
  pnpm --filter @portfolio/api start:dev                   # api (BFF)

# 통합(전체 스택): 루트 compose — postgres/redis/서비스 3개
docker compose up -d --build        # ⚠ WSL Docker Hub 이슈 시 이미지 pull 필요
```

## 워크스페이스 구성

```
packages/shared/      @shared/schemas          Zod SSOT (Product, Order, Event, Recommend, GeneratedContent)
apps/search-rec/      @search/search-rec-app   시맨틱 검색 + 추천 서비스 (:3001)
apps/ai-gen/          @ai/ai-gen-app           Stream consumer + 가드레일 서비스 (:3002 /health)
apps/api/             @portfolio/api           BFF 게이트웨이 (:3000) — 도메인 import 0, HTTP 프록시만
infra/                docker-compose           로컬 개발 인프라만 (pgvector + redis)
postgres/init/        init SQL                 컨테이너 최초 생성 시 자동 실행
```

- **패키지 매니저는 pnpm 고정.** `npm install`/`npx`는 `workspace:*` 프로토콜을 해석 못 해 `EUNSUPPORTEDPROTOCOL`로 실패함. `pnpm --filter <pkg>`, `pnpm exec`만 사용.
- `pnpm-workspace.yaml`이 **유일한** 워크스페이스 설정 파일. 루트 `package.json`의 `workspaces` 필드는 pnpm이 무시함(WARN).
- `pnpm --filter <패키지명>`으로 특정 패키지 대상 지정.

## 경로 별칭 (tsconfig.json)

```ts
import { ProductBaseSchema } from '@shared/schemas';  // → packages/shared/src/index.ts
```

런타임 해석은 `tsx`가 처리. 개발 환경에서 별도 빌드 불필요.
도메인 모듈 별칭(`@search/*`, `@ai/*`)은 **폐기** — 서비스 분리 후 남겨두면 우회 import 통로가 됨.

## TypeScript / NestJS

- 루트 `tsconfig.json`에 `experimentalDecorators`, `emitDecoratorMetadata` (모든 패키지 상속).
- `@nestjs/cli` 미사용. `tsx watch src/main.ts`가 각 서비스의 개발 실행기(`start:dev`).
- **SWC 필수**: tsx 기본 엔진 esbuild는 데코레이터 미지원. 루트에 `@swc/core` 설치돼 있으면 tsx가 자동 전환. 그래도 DI 메타데이터는 불안정하므로 **컨트롤러는 `@Inject()` 명시 필수**(검증됨: 없으면 undefined 주입).
- 문자열 토큰 주입(`'PG_POOL'`, `'REDIS_CLIENT'`)은 팩토리 `inject`에 문자열로, 생성자에는 `@Inject('TOKEN')`으로.

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

## node-postgres 타입 함정 (검증됨)

- `bigint` → **string** 반환: `Number(row.id)` 변환 필수 (repository `mapRow` 패턴 사용)
- `timestamp` → **Date** 반환: Zod가 `z.string().datetime()` 기대 시 `.toISOString()` 변환 필수
- `numeric` → **string** 반환: `price::float8` 캐스트로 회피

## Zod: ProductBaseSchema vs ProductSchema

`ProductSchema`는 `ProductBaseSchema.superRefine(...)`로 만든 `ZodEffects`라 **`.extend()` 불가**.

```ts
// ✅ 확장 필요 시 기본 스키마 사용
import { ProductBaseSchema } from '@shared/schemas';
const Extended = ProductBaseSchema.extend({ similarity: z.number() });

// ❌ ProductSchema.extend() → TS 오류
```

## 인프라 포트 & 비밀번호

`infra/.env`의 `PG_PORT`가 **호스트 포트** 결정(컨테이너 남부는 항상 5432). 호스트 포트가 바뀌면 `DATABASE_URL`도 같은 포트여야 함.

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
- `generated_contents`는 **ai-gen 마이그레이션**으로 생성. `source_event_id + content_type` UNIQUE가 멱등 키.
- 모든 SQL은 파라미터 바인딩(`$1`, `$2`, `ANY($1::bigint[])`)만. 템플릿 리터럴 보간 금지.

## EmbeddingProvider / GenerationProvider 선택

`SearchRecModule.forRoot()`에 선택적으로 `embeddingProvider` 전달. 기본 = `DummyEmbeddingProvider`(SHA-256 → 결정론적 벡터). 프로덕션:

```ts
import { createHttpEmbeddingProvider } from '@search/search-rec-app';
SearchRecModule.forRoot({ pgPool, redis, embeddingProvider: createHttpEmbeddingProvider() });
```

`AiGenModule.forRoot()`에 선택적으로 `generationProvider` 전달. 기본 = `DummyGenerationProvider`(결정론). `createHttpGenerationProvider`는 `GEN_BASE_URL`, `GEN_API_KEY`, `GEN_MODEL` 환경변수를 읽음.

## pnpm 빌드 승인 (onlyBuiltDependencies / allowBuilds)

`pnpm-workspace.yaml`의 `allowBuilds`에 네이티브 빌드 스크립트 패키지(**`esbuild`, `@swc/core`, `@nestjs/core`**)를 등록해야 함. 미등록 시 `ERR_PNPM_IGNORED_BUILDS`로 `pnpm exec`/`pnpm i` 실패. 차단되면 `pnpm approve-builds` 대화형 실행 후 `pnpm i` 재실행.

## API 엔드포인트

게이트웨이 기준 (`api :3000` → 프록시 → `search-rec :3001`):

```
GET  /api/health                          # 게이트웨이 health (search-rec up 여부)
GET  /api/search?q=무선이어폰&topK=5
GET  /api/recommend/home?userId=<uuid>&topK=10
GET  /api/recommend/related?productId=1&topK=6
POST /api/recommend/invalidate-home  {"userId":"..."}
```

서비스 직접:

```
GET  http://localhost:3001/health    # search-rec (pg/redis ping)
GET  http://localhost:3001/search, /recommend/*   # BFF 경유와 동일 계약
GET  http://localhost:3002/health    # ai-gen (pg/redis/consumer 생존)
```

## 콜드스타트 참고

`RecommendService.getUserProfile()`은 무조건 `null` 반환(TODO). 따라서 `/recommend/home`은 **항상 콜드스타트 경로(popularity만)** 로 동작하며, 사용자 프로필 서비스 연동 전까지 affinity 신호는 동작 안 함. 콜드스타트 경로는 임의 UUID로 테스트 가능.
- **UI/프론트 작업 시 `DESIGN.md`를 먼저 읽어 스타일을 따를 것.**
