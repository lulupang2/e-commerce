# Handoff — 2026-07-22

## 진행 상태

- [x] STEP 1~4: R 증거4종 / 결정론 / 캐시+무효화 / 콜드스타트 (search-rec)
- [x] ADR-0003 설계 → modules/ai-gen 구현 → 가드레일·멱등 검증
- [x] ADR-0004 저장 + `verified_at` 컬럼 (가드레일 정직 기록)
- [x] ADR-0005 설계 → **MSA 1단계 분리 완료** (modules/* → apps/*)
- [ ] apps/api 이벤트 producer (상품생성/리뷰누적 시 XADD) — 후속 과제
- [ ] getUserProfile() 콜드스타트 TODO (R, B와 독립)
- [ ] Docker 이미지 빌드 미검증 — WSL Docker Hub 인증 오류 (로컬 node 이미지 부재, pull 불가). Dockerfile은 로컬 3프로세스 런타임 검증과 동일 명령(`pnpm --filter ... start`) 사용으로 대체 검증

## MSA 분리 (이번 세션)

### 구조 변경
```
modules/search-rec → apps/search-rec   (@search/search-rec-app, :3001)
modules/ai-gen     → apps/ai-gen       (@ai/ai-gen-app,       :3002 /health)
apps/api           → BFF 프록시로 전환   (:3000, 도메인 import 0)
```

### 신규 파일
- `apps/search-rec/src/main.ts`, `src/app.module.ts` (HealthController — pg/redis ping)
- `apps/ai-gen/src/main.ts`, `src/app.module.ts` (HealthController — pg/redis/consumer 생존)
- `apps/api/src/search-rec-proxy.controller.ts` (HTTP 프록시, 10s 타임아웃, 502 폼백)
- `apps/api/src/health.controller.ts` (search-rec /health 경유 확인)
- `apps/{api,search-rec,ai-gen}/Dockerfile` (워크스페이스 루트 컨텍스트)
- `docker-compose.yml`에 search-rec/ai-gen/api 서비스 추가 (서비스명 통신, healthcheck, depends_on: service_healthy)

### 코드 변경
- `StreamConsumer.isRunning()` 공개 (health용)
- `apps/api/package.json`: `@search/search-rec`, `@ai/gen` 의존 제거
- 직접 import 검사: `grep -rn "from '@search/\|from '@ai/" apps/api/src/` → 0건

### 검증 (로컬 3프로세스)
- health 3종: `{:3001,:3002,:3000/api}/health` 모두 `status:ok`
- R 프록시: `/api/search`, `/api/recommend/home`, `/api/recommend/invalidate-home` → 200/201
- B 플로우: XADD → ai-gen 소비 → `status=published, verified_at=SET`
- `pnpm exec tsc --noEmit` → 0 errors
- `docker compose config` → 유효, 서비스 5개

### 주의사항
- 컨테이너 간 통신은 서비스명(`postgres`, `redis`, `search-rec`) — localhost 금지
- ai-gen health의 consumer 상태는 폴 루프 플래그 기준 (NOGROUP 자동 복구 로직 포함)
- search-rec는 글로벌 프픽스 없음(낙부 서비스), api만 `/api` 프픽스 → 프록시 경로 매핑 주의
