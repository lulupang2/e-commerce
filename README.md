# AI-native e커머스 MSA 포트폴리오

**의미론 검색 · 이유 있는 추천 · 비동기 AI 생성 · 3종 가드레일**

> 이 저장소는 **OpenCode 에이전트로 전체 제작**된 AI 원주민(native) e커머스 백엔드입니다. 설계(GL M-5.2), 구현(DeepSeek), 리뷰(Kimi) — 역할별 모델 라우팅을 적용했으며, **모든 AI 산출물은 `git diff`로 인간이 검수·채택·기각**했습니다.

---

## 1. 해결하려는 문제

| 문제 | 기존 접근 | 이 프로젝트의 접근 |
|------|-----------|-------------------|
| 키워드 검색으로는 "무선이어폰"으로 "버즈"를 못 찾음 | LIKE '%keyword%' | pgvector cosine 유사도 + pg_trgm 폴백 |
| 상품 설명을 MD가 수동 작성 → 비용·속도 한계 | 수기 작성 | LLM 비동기 생성 (product.created 이벤트 트리거) |
| 추천 결과에 이유가 없어 신뢰도 낮음 | 단순 인기순 | 4신호(S/P/A/C) + 규칙 기반 reason 공개 |
| AI 생성물의 할루시네이션·비용·노출 리스크 | 없음 (생성 안 함) | Zod 검증 + 토큰예산 + rejected/needs_human_review 차단 |

---

## 2. 기술 스택 + 선정 트레이드오프

| 기술 | 역할 | 왜 이것인가 |
|------|------|------------|
| **NestJS** | 서비스 프레임워크 | DI·모듈·가드 — MSA 분리 시 `forRoot()` 동적 모듈로 제로 코드 변경 |
| **Postgres + pgvector** | 벡터 검색 | 새 벡터 DB(Weaviate/Pinecone) 추가 없이 기존 OLTP에 통합 — 운영 복잡도 최소 |
| **Redis 7** | 캐시 + Stream + 락 | 단일 인프라 3가지 역할 — 캐시(추천 결과), 이벤트버스(ai-gen), 동기 invalidation |
| **Zod** | 스키마 SSOT | TypeScript 타입 + 런타임 검증 단일 소스 — `packages/shared`로 모든 서비스 공유 |
| **pnpm workspace** | 모노레포 | `workspace:*` 프로토콜로 내부 의존성 버전 일치 — `npm`은 이 프로토콜 해석 불가 |
| **tsx + SWC** | 런타임 트랜스파일 | esbuild는 NestJS 데코레이터 미지원 → SWC(`legacyDecorator:true`)로 해결 |

---

## 3. 아키텍처 (MSA 1단계 — ADR-0005)

```mermaid
graph TD
    CLIENT[클라이언트]

    subgraph "apps/api :3000 (BFF Gateway)"
        BFF[SearchRecProxyController]
        H1[/health]
    end

    subgraph "apps/search-rec :3001 (HTTP)"
        SR[시맨틱 검색 + 추천]
        H2[/health]
    end

    subgraph "apps/ai-gen :3002 (Consumer)"
        AG[생성 + 가드레일]
        H3[/health]
    end

    subgraph "Infra"
        PG[(Postgres + pgvector)]
        R[(Redis 7)]
    end

    SHARED["@shared/schemas (Zod SSOT)"]

    CLIENT -->|"GET /api/search"| BFF
    BFF -->|"HTTP fetch (proxy)"| SR
    BFF -.->|"XADD ai:events (후속)"| R
    SR -->|pg| PG
    SR -->|redis| R
    AG -->|"XREADGROUP"| R
    AG -->|pg| PG

    SR --> SHARED
    AG --> SHARED

    style BFF fill:#e1f5fe
    style SR fill:#fff3e0
    style AG fill:#fce4ec
```

- **R(검색/추천) = 동기 HTTP**: BFF가 search-rec를 HTTP 프록시. 직접 import 0.
- **B(생성) = 비동기 이벤트**: ai-gen은 Redis Stream consumer. product.created 이벤트 구독.
- **S(shared) = SSOT**: 모든 서비스가 `@shared/schemas`만 import — 모듈 경계 엄수.

---

## 4. 핵심 구현

### 4.1 의미론 검색 + 폴백 ([ADR-0002](./docs/decisions/adr-0002-vector-search-fallback.md))

```
pgvector cosine(<=>) → max similarity < 0.7? → pg_trgm similarity(name||desc, query) → 폴백
```

- HNSW 인덱스로 근사 검색, `DummyEmbeddingProvider`(SHA-256)로 LLM 없이 검증 가능
- `SearchCacheService`로 Redis 캐싱 (TTL 300s, 동일 쿼리 2회차 0ms)

### 4.2 이유 있는 추천 ([ADR-0003](./docs/decisions/adr-0003-explainable-recommendation-cache.md))

4신호 가중합 + 규칙 기반 reason + 캐시 무효화:

| 신호 | 가중치(개인화) | 가중치(콜드스타트) |
|------|:---:|:---:|
| **S**emantic (벡터 유사도) | 0.5 | 0 |
| **P**opularity (로그 정규화) | 0.3 | 0.8 |
| **A**ffinity (카테고리 선호) | 0.2 | 0.2 |
| **C**ombined | 가중합 | 가중합 |

- 응답에 `reason`(문장) + `signals`(숫자) 포함 → 왜 이 상품인지 투명
- `POST /recommend/invalidate-home` → 캐시 무효화 (signalVersion INCR)
- 콜드스타트 분기: `getUserProfile()` null → popularity 전용, embeding 없음 → 인기도 폴백

### 4.3 비동기 생성 + 3종 가드레일 ([ADR-0004](./docs/decisions/adr-0004-async-generation-guardrail.md))

```
product.created → XADD ai:events → XREADGROUP ai-gen-group
  → GenerationProvider.generate(prompt)
  → GuardrailService.validate(raw) → Zod 검증
  → pass: verified → published / fail: rejected + needs_human_review=true
```

| 가드레일 | 메커니즘 | 실패 처리 |
|----------|----------|-----------|
| **유효성** | `GeneratedContentSchema`(Zod) — 필수필드·길이·금지어 | `status=rejected` + rejectionReason |
| **비용** | 일일 토큰 예산 (500K) + 입력 해시 dedup | 생성 스킵, needs_human_review |
| **폴백** | `published`만 클라이언트 노출 | `rejected`는 절대 반환 안 됨 |

- 멱등 3중: Redis SETNX + DB `findBySourceEventId` + `UNIQUE(event_id, content_type)`
- `verified_at` 컬럼으로 검증 경유 흔적 영속 (skip vs verify 판별)

### 4.4 모놀리스 → MSA 점진 전환 ([ADR-0005](./docs/decisions/adr-0005-modular-monolith-to-msa.md))

추출 기준표(4축)로 과잉 설계 방어 — **3개 이상 충족 시에만 분리 후보**:

| 기준 | search-rec | ai-gen | product/order |
|:-----|:---:|:---:|:--:|
| 변경주기 다름 | ✅ | ✅ | ❌ |
| 리소스 프로파일 다름 | ✅ | ✅ | ❌ |
| 장애 격리 필요 | ✅ | ✅ | ❌ |
| 결합 제거 비용 낮음 | ✅ | ✅ | ❌ |

- product/order/payment/inventory는 단일 트랜잭션 경계(saga 비용 > 이득)로 현재 보류
- 물리적 증거: `{modules → apps}/search-rec/*` (git mv, 히스토리 보존), `58 files, +2002/-95`

### 4.5 검증 결과 요약

| 항목 | 결과 | 방법 |
|------|------|------|
| **tsc --noEmit** (전체 타입체크) | 0 errors | `pnpm exec tsc --noEmit` |
| **직접 import = 0** (모듈 경계) | `grep "@search/\|@ai/" apps/api/src/` = 0건 | 서비스 간 통신은 HTTP/Stream만, shared만 공유 |
| **3서비스 health** | `{:3000,/api/health}` = ok / `{:3001,/health}` = {pg:up, redis:up} / `{:3002,/health}` = {pg:up, redis:up, consumer:running} | 진짜 의존성 ping 포함 (SELECT 1, PING, consumer loop flag) |
| **R: 검색** | `/api/search?q=무선` → 200, `source=trgm_fallback` | 벡터 임계치 미달 → 폴백 정상 |
| **R: 추천 home** | `/api/recommend/home` → 200, `source=cold_start_user`, popularity=0.28~0.30 | S=0, P=정상 (bigint fix 후), A=TODO |
| **R: 추천 related** | `/api/recommend/related?productId=1` → 200, semantic=0.11~0.23, `source=personalized` | 벡터 유사도 S>0 확인 |
| **R: 캐시 무효화** | cached 2ms → POST invalidate → recompute tookMs=4ms | `signalVersion` INCR → 캐시 키 폐기 |
| **R: 결정론** | 동일 userId 2회 호출 → `diff <(del(.tookMs))` = 0 | DummyEmbeddingProvider(SHA-256) + 규칙 기반 reason |
| **B: 이벤트 → 소비** | XADD → 6s → `generated_contents(status=published, verified_at=SET, token_count=89)` | Stream consumer 정상, guardrail 통과 |
| **B: 가드레일-유효성** | 금지어 입력 → `status=rejected, needs_human_review=true` | `BANNED_WORDS` + Zod refine |
| **B: 멱등** | 동일 eventId 2회 XADD → `SELECT count(*)` = 1 | Redis SETNX + `findBySourceEventId` + `UNIQUE(source_event_id, content_type)` |
| **compose config** | `docker compose config --services` → 5개 (postgres, redis, search-rec, ai-gen, api) | 서비스명 DNS 통신, `depends_on: service_healthy` |

> ⚠️ **Docker 이미지 빌드는 WSL Docker Hub 인증 오류로 미검증** — 로컬 3프로세스 `tsx` 실행으로 동일 명령 대체 검증 완료.

---

## 5. 트러블슈팅 (실제 겪은 버그)

| # | 현상 | 원인 | 해결 |
|---|------|------|------|
| 1 | **popularity 신호 항상 0** | node-postgres가 `BIGINT`를 string으로 반환 → `Map.set("1", score)`이 `Map.get(1)` lookup 실패 | `Number(row.product_id)` ([관련 커밋](#)) |
| 2 | **CRLF → Docker init SQL 미실행** | WSL2 Windows ↔ Linux 파일 공유 시 CRLF 개행 유입 | `.editorconfig` + `.gitattributes`로 `eol=lf` 강제 |
| 3 | **npm `EUNSUPPORTEDPROTOCOL`** | npm은 `workspace:*` 프로토콜 미지원 | `pnpm` 고정 — `pnpm-workspace.yaml`이 유일한 워크스페이스 설정 |
| 4 | **esbuild 데코레이터 미지원** | tsx 기본 엔진 esbuild가 `experimentalDecorators` 파싱 불가 → NestJS 부트스트랩 실패 | `@swc/core` 설치 (tsx 자동 전환) + `.swcrc` |
| 5 | **NestJS DI undefined 주입** | `emitDecoratorMetadata` 미방출 → 생성자 타입 추론 실패 | 모든 컨트롤러에 `@Inject(ServiceClass)` 명시 |
| 6 | **Redis cache stale → 500 반복** | 잘못된 형식의 응답이 캐시되어 Zod 검증 실패 | `FLUSHALL` + cache invalidation 으로 재계산 |

---

## 6. 회고 (다시 한다면?)

| 교훈 | 조치 |
|------|------|
| **AI 스캐폴드 devDependency 누락** (typescript) → `tsc --noEmit` 실패 | 리뷰 체크리스트에 `pnpm exec tsc --noEmit` 자동화를 포함 |
| **워크스페이스 도구 불일치** (npm vs pnpm) → 초기 혼란 | README/ADR/CI에 패키지 매니저를 단일 고정하고 `engines` 필드로 강제 |
| **`verified_at` 컬럼 후행 추가** — published가 실제 검증을 통과했는지 구분 불가 | ADR-0004 정직 기록에 명시했듯, 상태 전이는 영속적 흔적을 처음부터 남길 것 |
| **DummyProvider의 token 추정** (89 = `text.length/4`) — 실제 LLM 연동 전까지 정확한 비용 알 수 없음 | `GenerationProvider` interface에 `getTokenCount()`를 포함시켜 실제 API 응답에서 추출하도록 개선할 것 |

---

## 7. AI 활용 명시

이 프로젝트는 **OpenCode (Go)** 로 전체 제작되었습니다.

| 역할 | 모델 | 담당 |
|------|------|------|
| 설계·아키텍처 | GL M-5.2 | ADR 5종, MSA 전환 설계, 트레이드오프 판단 |
| 구현 | DeepSeek | NestJS 코드, pgvector 쿼리, Redis Stream consumer |
| 리뷰 | Kimi | 타입체크, 경계 조건, 가드레일 검증 |

- **AI 결과 맹신 금지**: 모든 AI 생성물은 `git diff`로 인간이 검수·채택·기각 (AGENTS.md 규칙)
- **Popularity 버그를 인간 검수로 잡아낸 사례**: AI 구현체는 `Map<string, number>` 이슈를 인지하지 못함 — 검증 단계에서 `items[].signals.popularity === 0`을 발견하고 트러블슈팅
- **AGENTS.md 자동 수정 루프**: 성공조건 + 반복 상한(같은 에러 3회)을 명시, bash로 직접 검증 ("확인해보세요" 금지)

---

## 8. 가드레일

**AI 생성물을 검증 없이 노출하지 않습니다.**

```
생성 → Zod 검증 → verified → published (노출 가능)
                 → 실패 → rejected + needs_human_review=true (절대 노출 안 됨)
```

- `SELECT ... WHERE status='published'` 만 클라이언트 응답에 포함 — `rejected`·`draft`는 코드 경로에서 구조적으로 차단
- `BANNED_WORDS: ['fake', '거짓', '사기']` — Zod refine로 body 검사, 위반 시 rejected
- **비용 폭발 방지**: Redis `ai:budget:{tenant}:{YYYYMM}` INCRBY (일 500K 토큰), 입력 hash dedup (1h TTL)
- **DLQ**: 5회 재시도 실패 → `ai:dlq` Stream에 적재, 자동 소비 안 함 (수동 개입 필요)

---

## 9. MSA 전환 서사

> "완성한 후에 분리한다" — 모듈식 모놀리스로 기능 검증 → 1단계 분리

1. **초기 (모듈식 모놀리스)**: `apps/api`가 SearchRecModule과 AiGenModule을 in-process import. 모든 기능이 한 프로세스에서 동작.
2. **R+B 완주**: 검색·추천(동기) + 생성·가드레일(비동기) 기능 완성 및 검증 완료.
3. **분리 판정**: ADR-0005 추출 기준표로 search-rec(4/4), ai-gen(4/4) 분리 결정. product/order(1/4)는 saga 비용으로 보류.
4. **MSA 1단계 실행**:
   - `git mv modules/search-rec apps/search-rec` — 히스토리 보존
   - `apps/api` → BFF 프록시로 전환 (직접 import 0)
   - `docker-compose.yml`에 3개 서비스 컨테이너 추가, 서비스명 DNS 통신
5. **증거**: `git diff --stat 4e587b2..HEAD` → **58 files, +2002/-95**

---

## 10. 시작하기

```bash
# 1. 설치
pnpm i

# 2. 인프라 기동 (Postgres + Redis)
cd infra && cp .env.example .env && docker compose up -d

# 3. 마이그레이션
docker exec -i portfolio-postgres psql -U portfolio -d portfolio < apps/search-rec/migrations/002-product-views.sql
docker exec -i portfolio-postgres psql -U portfolio -d portfolio < apps/ai-gen/migrations/001-generated-content.sql
docker exec -i portfolio-postgres psql -U portfolio -d portfolio < apps/ai-gen/migrations/004-verified-at.sql

# 4. 시드
DATABASE_URL="postgresql://portfolio:change-me@localhost:5432/portfolio" \
  pnpm --filter @search/search-rec-app seed

# 5. 3개 서비스 기동 (각 터미널)
PORT=3001 pnpm --filter @search/search-rec-app start:dev   # search-rec
PORT=3002 pnpm --filter @ai/ai-gen-app start:dev           # ai-gen
PORT=3000 SEARCH_REC_URL=http://localhost:3001 \
  pnpm --filter @portfolio/api start:dev                   # BFF

# 6. 검증
curl -s "http://localhost:3000/api/search?q=무선이어폰&topK=5"
curl -s "http://localhost:3000/api/recommend/home?userId=$(uuidgen)&topK=5" | jq '.items[0].reason'
```

### 통합 (Docker Compose)

```bash
docker compose up -d --build    # postgres + redis + api + search-rec + ai-gen
docker compose ps               # 5개 서비스 모두 healthy
```

---

## 🌐 데모

| 환경 | URL | 비고 |
|------|-----|------|
| **프론트** | https://<vercel-url>.vercel.app | Next.js RSC, Stripe 스타일 |
| **API** | https://<railway-url>.up.railway.app/api/health | BFF 게이트웨이 |
| **search-rec** | https://<railway-url>.up.railway.app/health | pg/redis ping |
| **ai-gen** | https://<railway-url>.up.railway.app/health | consumer 생존 확인 |

> ⚠️ **첫 로딩 30초~1분 지연** — Railway 무료 티어는 5분 비활성 시 서비스가 sleep 됩니다. 방문 후 잠시 기다려주세요.

### 배포 후 검증

```bash
# health check (3서비스)
curl -s https://<api>.up.railway.app/api/health
curl -s https://<search-rec>.up.railway.app/health
curl -s https://<ai-gen>.up.railway.app/health

# R: 추천 검증
curl -s "https://<api>.up.railway.app/api/recommend/home?userId=550e8400-e29b-41d4-a716-446655440000&topK=3" | jq '.items[0].reason'

# B: 생성 검증
railway run "pnpm --filter @ai/ai-gen-app seed"
railway run --service postgres "psql \$DATABASE_URL -c 'SELECT status, verified_at IS NOT NULL FROM generated_contents;'"
```

---

## 11. 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/api/health` | 게이트웨이 health (search-rec 생존 확인) |
| `GET` | `/api/search?q=...&topK=5` | 의미론 검색 |
| `GET` | `/api/recommend/home?userId=...&topK=10` | 개인화 추천 (현재 콜드스타트) |
| `GET` | `/api/recommend/related?productId=...&topK=6` | 관련 상품 추천 |
| `POST` | `/api/recommend/invalidate-home` | 추천 캐시 무효화 |
| `GET` | `:3001/health` | search-rec (pg/redis ping) |
| `GET` | `:3002/health` | ai-gen (pg/redis/consumer 생존) |

---

## 12. 문서

| 문서 | 내용 |
|------|------|
| [ADR-0001](./docs/decisions/adr-0001-shared-schema-ssot.md) | Zod SSOT, 불변식, 스키마 진화 |
| [ADR-0002](./docs/decisions/adr-0002-vector-search-fallback.md) | pgvector cosine + pg_trgm 폴백 + SWC 트랜스파일 |
| [ADR-0003](./docs/decisions/adr-0003-explainable-recommendation-cache.md) | 4신호 S/P/A/C, 결정론, 캐시 무효화 |
| [ADR-0004](./docs/decisions/adr-0004-async-generation-guardrail.md) | Redis Stream consumer, 3종 가드레일, 멱등 |
| [ADR-0005](./docs/decisions/adr-0005-modular-monolith-to-msa.md) | 모놀리스 → MSA 1단계, 추출 기준표, Mermaid |
| [AGENTS.md](./AGENTS.md) | 에이전트 운영 규칙, 아키텍처, 필수 명령어 |
| [handoff.md](./docs/handoff.md) | 진행 상태, 버그 수정 내역, 미검증 항목 |
