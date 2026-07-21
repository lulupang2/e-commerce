# STEP 2. 비동기 AI 생성 + 가드레일 설계

> ADR-003 — 이벤트 기반 AI 생성 파이프라인 (2026-07-22, accepted)

## 설계 판결표

| # | 항목 | 결정 | 트레이드오프 |
|---|------|------|-------------|
| **1** | 동기(R) vs 비동기(B) 통신 | **생성 = 비동기 이벤트** (product.created → Stream → ai-gen consumer). 조회/검색(R)은 기존 동기 유지. | 생성은 LLM 외부 API (2~30초, 실패 가능) → 동기 호출은 HTTP 타임아웃/장애 전파. 비동기는 응답 지연 대신 **"generatedAt 미충족 시 null 반환"** 구조만 손해. |
| **2** | 이벤트 스키마 SSOT | 새 이벤트/생성물 스키마(`GeneratedContent`, `ContentStatusChanged`)는 **`packages/shared/src/schemas/`에만** 추가 — product·order(발행)와 ai-gen(구독)이 shared import. | **이벤트 스키마 진화 속도 저하** (shared 수정 시 전 모듈 rebuild) vs 컨트랙트 파편화 방지. |
| **3** | 멱등성 | `eventId`(UUID) 기준 — (a) Producer 발행 전 Redis `SETNX` dedup key (TTL 24h), (b) Consumer XREADGROUP + **DB `processed_events` 테이블** PK `event_id` 로 더블ACK 보장, (c) 실패 시 **XPENDING → XCLAIM 재할당** (1회→ 3회→ 5회 지수 backoff, 5회 초과_DLQ). | 복잡도 증가 (3단계 dedup) vs "정확히 한 번" 보장. 연산 비용 < 재생성 비용(비용·부작용)이면 멱등 우선 |
| **4a** | 가드레일 - 할루시네이션 | 생성물을 **`GeneratedContentSchema`(Zod)** 로 강제 검증 — 필수 필드/길이/금지어/구조. 검증 실패 시 `status=rejected` + 노출 금지 (`published` 불가). | 위양성(정상 출력 차단 가능) vs 사용자 노출 리스크. 디버그용 `rejectionReason` 보존으로 조정 가능. |
| **4b** | 가드레일 - 비용 | Redis 토큰 예산 카운터 (`ai:budget:{tenant}:{YYYYMMDD}` INCRBY, daily limit), 동일 입력 **중복 호출 제거** (`ai:dedup:sha256(input)` SETNX TTL 1h — 캐시 히트 시 DB에서 load). 레이트리밋은 Stream 소비 속도로 제어. | 캐시 적중률 의존 (신규 입력 비용 절감x) vs 무제한 호출 비용 폭발 방어. |
| **4c** | 가드레일 - 폴백 | 검증 실패/예산 초과 → `status=draft` (휴먼검수 플래그 `needsHumanReview=true`). **절대 `published` 안 됨** — 노출 경로는 `WHERE status='published'` 또는 null fallback 만 조회. | 판매자 대기 시간 발생 (빈 생성물) vs 잘못된 정보 노출 리스크. 콜드스타트 기간엔 `null` 반환. |
| **5** | 생성물 상태 머신 | `draft → verified → published / rejected`. verified = 스키마 통과, published = 승인(자동/수동), rejected = 검증 실패 또는 비용 초과. | `draft`/`rejected` 조회 차단 복잡도 vs 안전 노출 보장. 전이는 event-sourced (`content.status.changed`). |
| **6** | LLM 프로바이더 추상화 | `GenerationProvider` interface (R `EmbeddingProvider` 동일 패턴). `DummyGenerationProvider` = 결정론 템플릿 (테스트), `HttpGenerationProvider` = env 기반 실제 API. `SearchRecModule.forRoot({generationProvider})`로 교체. | 인터페이스 추상화 오버헤드 vs provider 교체 자유. Dummy=CI/로컬, Http=운영 전환 zero-code. |

## 모듈 경계 (1줄)

**`ai-gen` 모듈은 `@shared/schemas`, Redis, pg pool 에만 의존 — `product`/`order`/`review` 도메인 코드 직접 import 금지, 오직 "이벤트"로만 통신** (순환 의존 차단, 장애 격리).

## 상태 머신 다이어그램

```
         ┌──────────────────────────────────────────────────┐
         │                                                  │
         ▼                                                  │
  ┌──────────┐  zod 검증 pass  ┌──────────┐  자동/수동 승인  ┌───────────┐
  │  draft   │ ──────────────► │ verified │ ──────────────► │ published │
  │ (LLM 원본)│                 │ (스키마ok)│                  │ (노출가능) │
  └────┬─────┘                 └────┬─────┘                  └───────────┘
       │ zod 검증 fail              │ 승인 거부
       ▼                            ▼
  ┌──────────┐                ┌──────────┐
  │ rejected │ ◄──────────────│          │
  │(검증실패) │   비용 초과/   │ (거부)   │
  │needsHuman│   예외 폴백     │          │
  └──────────┘                └──────────┘
```

## 데이터 플로우 (이벤트 시퀀스)

```
[product.created]                     [review.accumulated]
       │                                     │
       │   ┌─────────────────────────────────┘
       ▼   ▼
  ┌─────────────┐  XADD  ┌──────────────┐  XREADGROUP  ┌──────────────┐
  │  producer   │ ────►  │ Redis Stream │ ──────────► │ ai-gen       │
  │ (order/api) │        │ ai:events    │             │ consumer     │
  └─────────────┘        └──────────────┘             └──────┬───────┘
                         ┌──────────────┐                    │
                         │ Redis dedup  │ ◄── SETNX          │
                         │ ai:dedup:*   │     eventId         │
                         │ ai:budget:*  │ ◄── INCRBY (tokens) │
                         └──────────────┘                    │
                                                             ▼
                                              ┌──────────────────────────┐
                                              │ GenerationProvider       │
                                              │   .generate(prompt)      │
                                              └────────────┬─────────────┘
                                                           │
                                                           ▼
                                              ┌──────────────────────────┐
                                              │ GeneratedContentSchema   │
                                              │   .safeParse(output)     │
                                              └────────┬─────────────────┘
                                                       │
                                       pass ┌──────────┘  fail
                                            │
                                            ▼            ▼
                                    status=verified  status=rejected
                                            │            │
                                            ▼            ▼
                                    pg insert      pg insert + needsReview=true
                                            │
                                            ▼ (approval)
                                    status=published
                                            │
                                            ▼
                                    [content.status.changed] ──► Stream
```

## Redis Stream 키 레이아웃

| Key pattern | Type | 목적 | TTL |
|-------------|------|------|-----|
| `ai:events` | Stream | 이벤트 버퍼 (product.created, review.accumulated) | 무한 (MAXLEN ~ trim) |
| `ai:events:$group` | Consumer group | `ai-gen-group` — XREADGROUP/XPENDING/XACK | 무한 |
| `ai:dedup:{eventId}` | String | Producer 중복 발행 방지 (SETNX) | 24h |
| `ai:dedup:sha256:{inputHash}` | String | 동일 입력 LLM 호출 방지 (캐시 키) | 1h |
| `ai:budget:{tenant}:{YYYYMMDD}` | String (int) | 일일 토큰 예산 카운터 (INCRBY) | 25h (자정 롤오버) |
| `ai:dlq` | Stream | Dead Letter Queue (5회 재시도 초과) | 무한 |

## pg 테이블 (마이그레이션 예정)

```sql
-- 생성물
CREATE TABLE generated_contents (
  id          BIGSERIAL PRIMARY KEY,
  content_key VARCHAR(100) NOT NULL,       -- "product.description:42"
  source_event_id UUID NOT NULL,           -- 멱등: 동일 eventId 재처리 차단
  aggregate_id   VARCHAR(100) NOT NULL,    -- productId 등
  content_type   VARCHAR(50) NOT NULL,     -- 'description' | 'marketing_copy'
  raw_output     JSONB NOT NULL,           -- LLM 원본 (디버그/재검증)
  validated      JSONB,                    -- zod 검증된 정제물
  status         VARCHAR(20) NOT NULL DEFAULT 'draft',  -- draft|verified|published|rejected
  rejection_reason TEXT,
  needs_human_review BOOLEAN NOT NULL DEFAULT FALSE,
  token_count    INTEGER NOT NULL DEFAULT 0,
  provider        VARCHAR(50) NOT NULL,    -- 'dummy' | 'http'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_event_id, content_type)   -- 멱등: 동일 이벤트+타입은 1건만
);

-- 멱등ACK (Consumer 더블ACK 보장)
CREATE TABLE processed_events (
  event_id    UUID PRIMARY KEY,
  event_name  VARCHAR(100) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumer_id  VARCHAR(100) NOT NULL,
  result       VARCHAR(20) NOT NULL          -- 'ok' | 'rejected' | 'error'
);

-- 상태 전이 로그 (event-sourced)
CREATE TABLE content_status_log (
  id          BIGSERIAL PRIMARY KEY,
  content_id  BIGINT NOT NULL REFERENCES generated_contents(id),
  from_status VARCHAR(20),
  to_status   VARCHAR(20) NOT NULL,
  reason      TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## 멱등성 3단계 (상세)

### Producer 측 (발행 전)
```
1. eventId로 Redis SETNX  (ai:dedup:{eventId}, TTL 24h)
   → 이미 존재 = 이미 발행됨, 스킵
   →SET 성공 = 신규, XADD ai:events
```

### Consumer 측 (소비 시)
```
2. XREADGROUP ≥ 메시지 수신
3. INSERT INTO processed_events (event_id, ...) ON CONFLICT DO NOTHING
   → 이미 처리됨 = XACK 후 스킵 (crash 후 재소비 정확성)
   → 신규 = 비즈니스 로직 실행
4. 성공 시 XACK (Redis Stream에서 제거)
5. 실패 시 XACK 안 함 → XPENDING → XCLAIM 재할당 → 지수 backoff
```

### 재소비 전략
```
deliveries=1 → 즉시 재시도
deliveries=2 → 5s backoff
deliveries=3 → 30s backoff
deliveries=4 → 120s backoff
deliveries≥5 → XADD ai:dlq + XACK (더 이상 재시도 안 함, 수동 개입)
```

## 가드레일 상세

### 4a. 할루시네이션 (출력 검증)
```ts
// packages/shared/src/schemas/generated-content.ts
export const GeneratedContentSchema = z.object({
  contentType: z.enum(['description', 'marketing_copy', 'summary']),
  title: z.string().min(5).max(100),
  body: z.string().min(20).max(2000),
  keywords: z.array(z.string()).max(10).optional(),
  bannedWordsChecked: z.literal(true),         // LLM에 금지어 검증 체결 강제
  language: z.enum(['ko', 'en']),
  confidence: z.number().min(0).max(1),
}).refine(v => !BANNED_WORDS.some(w => v.body.includes(w)), {
  message: 'banned word detected',
});

// 검증 실패 → 절대 published 안 됨
if (!parsed.success) {
  insert(status='rejected', rejectionReason=parsed.error, needsHumanReview=true);
  XACK; continue;   // 재시도 안 함 (영구 실패)
}
```

### 4b. 비용 (토큰 예산 + 중복 호출 제거)
```ts
// 일일 예산
const budgetKey = `ai:budget:${tenant}:${today()}`;
const used = await redis.incrby(budgetKey, tokenCount);
if (used > DAILY_TOKEN_LIMIT) → status=draft, needsHumanReview=true;

// 동일 입력 캐싱
const inputHash = sha256(prompt);
const cached = await redis.get(`ai:dedup:sha256:${inputHash}`);
if (cached) → load from DB (재생성 생략, 비용 0)
```

### 4c. 폴백 (안전 노출)
```
1. status 확인: WHERE status='published' → 노출 가능
2. 없으면 null 반환 (fallback)
3. ✗ 절대 draft/rejected 상태 노출 안 함
4. needsHumanReview=true 시 admin 대시보드 알림
```

## GenerationProvider 인터페이스 (R EmbeddingProvider 패턴 재사용)

```ts
// modules/ai-gen/src/provider/generation-provider.interface.ts
export abstract class GenerationProvider {
  abstract generate(prompt: string, opts: GenerateOpts): Promise<GenerateResult>;
}

// 결정론 (테스트/CI)
export class DummyGenerationProvider extends GenerationProvider {
  generate(prompt: string, _opts: GenerateOpts) {
    return Promise.resolve({
      content: JSON.stringify({ title: '...', body: '...' }),  // deterministic
      tokenCount: 0,
      raw: prompt,
    });
  }
}

// HTTP (운영, env 기반)
export class HttpGenerationProvider extends GenerationProvider {
  constructor(
    baseUrl = process.env['LLM_BASE_URL'] ?? '',
    apiKey  = process.env['LLM_API_KEY']  ?? '',
    model   = process.env['LLM_MODEL']    ?? 'gpt-4o-mini',
  ) { ... }
  async generate(...) { /* fetch POST /v1/chat/completions */ }
}

// 모듈 조립 (R SearchRecModule.forRoot 패턴 동일)
AiGenModule.forRoot({
  pgPool, redis,
  generationProvider: new HttpGenerationProvider(),  // 또는 new DummyGenerationProvider()
});
```

## 결론 (1줄)

**이벤트 기반 비동기 + Zod 강제 검증 + Redis Stream 멱등 + Dummy/Http 프로바이더 교체 — 기존 search-rec 아키텍처와 동일한 원칙(추상화, SSOT, 결정론 테스트) 재사용.**