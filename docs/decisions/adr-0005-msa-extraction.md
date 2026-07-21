# ADR-0005: search-rec·ai-gen 서비스 추출 (모듈식 모놀리스 → MSA 전환 1단계)

**날짜**: 2026-07-22
**상태**: accepted (2026-07-22 구현 완료 — modules/* → apps/*, 로컬 3프로세스 검증)

## 1. 왜 search-rec, ai-gen을 "먼저" 빼나

| 모듈 | 변경주기 근거 | 리소스·독립배포 근거 |
|------|--------------|---------------------|
| **search-rec** | 가중치·임계값·템플릿(`RecommendConfig`, `reason-templates`)은 상품 카탈로그 변경보다 훨씬 자주 튜닝됨 — 알고리즘 배포가 코어 커머스 API 재배포를 요구하는 구조는 비효율 | 벡터 검색(pgvector cosine)은 CPU·메모리 집중, LLM 임베딩 호출은 외부 I/O — 코어 API와 동일 스케일링 유닛에 묶을 이유가 없고, **검색 장애가 상품 CRUD를 죽이면 안 됨**(격리 필요) |
| **ai-gen** | 가드레일 규칙·금지어·프롬프트는 정책 변경에 따라 독립적으로 바뀜 — 커머스 로직과 변경주기가 완전히 다름 | 소비자 동시성(Stream 소비 속도)과 HTTP 처리량은 다른 스케일 차원. 외부 LLM 비용 정책(예산·레이트리밋)도 **독립 배포 없이는 핫픽스 불가** |

## 2. 왜 product/order/payment/inventory는 "아직" 안 빼나

주문→결제→재고는 **단일 트랜잭션 경계** 안의 강결합 — 분리하면 saga/보상 트랜잭션(분산 트랜잭션) 비용이 즉시 발생하며, 지금 그 대가를 치를 만큼 변경주기·리소스 분리 이득이 없다.

## 3. 분리 후 통신 — R/B 확립 패턴 그대로 유지

```
                        ┌──────────────┐
        HTTP /api/*     │              │   HTTP /search /recommend/*
  클라이언트 ──────────►│  apps/api    │──────────────────────────►┌───────────────┐
                        │  (BFF 게이트웨이)│                          │ search-rec    │
                        │              │◄───────────────────────────│ (HTTP 서비스) │
                        │              │   JSON 응답                  │ :3001         │
                        │              │                            └───────────────┘
                        │              │   XADD ai:events            ┌───────────────┐
                        │              │──────────────────────────► │ ai-gen        │
                        └──────────────┘   (Redis Stream, 이벤트)   │ (consumer)    │
                                                                     │ :3002(/health)│
                                                                     └───────────────┘
```

- **search-rec = HTTP**: BFF(`apps/api`)가 낡은 in-process 호출을 HTTP 프록시로 교체. 기존 동기 패턴(R) 유지 — 타임아웃·circuit breaker는 BFF 책임.
- **ai-gen = Redis Stream**: 기존 이벤트 구독 패턴(B) 그대로. 서비스화 후에도 producer↔consumer 계약은 `shared/events.ts` 하나뿐.

## 4. 결합도 규칙 (불변)

- `packages/shared` = 유일한 공유물 (Zod 스키마 SSOT). **직접 import = 0**, 통신은 오직 HTTP(Request/Response JSON)와 이벤트(Redis Stream payload)만.
- shared 진화 시 **semver 스키마 버전**(`BaseEventSchema.schemaVersion`)으로 하위호환 판정 — 서비스별 독립 배포 중 구버전 이벤트 수신을 허용.

## 5. 각 서비스 부트스트랩

| 서비스 | main.ts | 포트 | health check | 핵심 외부의존 |
|--------|---------|------|--------------|--------------|
| `apps/api` | `main.ts` (기존) | 3000 | `GET /health` → `{status, deps:{searchRec}}` | search-rec HTTP |
| `apps/search-rec` | `main.ts` (신규) | 3001 | `GET /health` → `{status, deps:{pg, redis}}` | pg, redis |
| `apps/ai-gen` | `main.ts` (신규) | 3002 | `GET /health` → `{status, deps:{pg, redis, consumer: running}}` | pg, redis, stream |

health check는 **진짜 의존성 ping**을 포함 — `pg: SELECT 1`, `redis: PING`, consumer는 폴 루프 생존 플래그. 단순 200이면 장애 전파를 감지 못 한다.

## 6. docker-compose (서비스 단위)

```yaml
services:
  postgres:  { image: pgvector/pgvector:pg16, healthcheck: pg_isready }
  redis:     { image: redis:7-alpine, healthcheck: redis-cli ping }

  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    ports: ["3000:3000"]
    environment:
      SEARCH_REC_URL: http://search-rec:3001     # 서비스명 = 낙낙 DNS, localhost 금지
      REDIS_URL: redis://:change-me@redis:6379
    depends_on: { search-rec: { condition: service_healthy }, redis: { condition: service_healthy } }
    healthcheck: curl -f http://localhost:3000/health

  search-rec:
    build: { context: ., dockerfile: apps/search-rec/Dockerfile }
    environment:
      DATABASE_URL: postgresql://portfolio:change-me@postgres:5432/portfolio
      REDIS_URL: redis://:change-me@redis:6379
    depends_on: { postgres: { condition: service_healthy }, redis: { condition: service_healthy } }
    healthcheck: curl -f http://localhost:3001/health

  ai-gen:
    build: { context: ., dockerfile: apps/ai-gen/Dockerfile }
    environment:
      DATABASE_URL: postgresql://portfolio:change-me@postgres:5432/portfolio
      REDIS_URL: redis://:change-me@redis:6379
      GEN_BASE_URL: ${GEN_BASE_URL:-}            # LLM env, 기본 더미
    depends_on: { postgres: { condition: service_healthy }, redis: { condition: service_healthy } }
    healthcheck: curl -f http://localhost:3002/health
```

- **localhost 금지**: 컨테이너 간 통신은 compose 서비스명(`postgres`, `redis`, `search-rec`)으로 DNS 해석.
- `depends_on + condition: service_healthy`로 기동 순서가 아니라 **준비 완료**를 보장.

## 7. 과잉설계 방어 — "왜 지금 이 모듈만" 의 문서화 규칙

README/ADR에 **추출 기준표**를 명시하고, 충족한 모듈만 뺀다고 선언:

| 추출 기준 | search-rec | ai-gen | product/order |
|-----------|:---:|:---:|:---:|
| 코어 도메인과 변경주기 다름 | ✅ | ✅ | ❌ (함께 바뀜) |
| 리소스 프로파일 다름 (CPU/GPU/외부API) | ✅ | ✅ | ❌ |
| 독립 장애 격리 필요 | ✅ | ✅ | ❌ (트랜잭션 공유) |
| 동기 결합 없음 or 제거 비용 낮음 | ✅ (HTTP 프록시화) | ✅ (이벤트, 이미 분리됨) | ❌ (saga 필요) |

**규칙: 3개 이상 ✅ 일 때만 추출 후보.** product/order/payment/inventory는 saga 비용을 정당화할 기준 충족 전까지 모놀리스에 남긴다. 이 표 자체가 "왜 나머지는 안 뺐나"에 대한 영구 답변이며, 향후 재평가 시 이 표만 갱신한다.

## 전환 시 주의 (기존 검증 자산 유지)

- BFF 프록시는 기존 `/api/search`, `/api/recommend/*` 응답 계약(Zod)을 그대로 통과시킨다 — 클라이언트 무감지.
- `apps/api`에 **producer 추가 필요**: 현재 이벤트 발행은 seed 스크립트에만 존재. 상품 생성/리뷰 누적 시점에 `shared/events.ts` 스키마로 XADD하는 프로듀서가 apps/api(또는 향후 product 모듈)에 새로 생긴다.
- 로컬 개발은 여전히 `pnpm exec tsx` 단일 프로세스로 가능(모놀리스 모드 유지) — compose는 통합검증·데모용.
