# Railway + Vercel 배포 가이드

## 사전 준비

```bash
npm install -g @railway/cli
railway login
```

## 1. Railway 프로젝트 생성

```bash
railway init                    # 빈 프로젝트 생성 (또는 Railway 대시보드에서 New Project)
```

## 2. Postgres + Redis 추가

```bash
# Railway 대시보드 > New > Database > Postgres
# Railway 대시보드 > New > Database > Redis

# 또는 CLI (Railway v3+):
railway add --database postgres
railway add --database redis
```

## 3. pgvector 확장 활성화 (1회)

```bash
# railway run 은 컨테이너 환경에서 실행 — 로컬 파일 참조 불가, -c 로 인라인 실행
railway run --service Postgres psql -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

> ⚠️ Railway가 자동생성한 서비스명은 `Postgres`(대문자 P), `Redis`(대문자 R).
> `railway service list`로 정확한 서비스명을 확인할 것.

## 4. 백엔드 서비스 배포

```bash
# 각 서비스 폴더에서 배포 (Procfile 기준으로 서비스 타입 자동 감지)
cd apps/search-rec && railway up --detach    # web (:3001)
cd ../ai-gen && railway up --detach          # worker (consumer)
cd ../api && railway up --detach             # web (:3000)
# railway up 은 최초에만 서비스 생성. 이후 변경사항은 railway deploy
```

## 5. 환경변수 설정

각 서비스의 Railway 대시보드 > Variables:

| 서비스 | 변수 | 값 |
|--------|------|-----|
| **search-rec** | `PORT` | `3001` |
| | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (자동 참조) |
| | `REDIS_URL` | `${{Redis.REDIS_URL}}` (자동 참조) |
| **ai-gen** | `PORT` | `3002` |
| | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| | `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| | `GEN_BASE_URL` | (선택 — 없으면 DummyProvider) |
| **api** | `PORT` | `3000` |
| | `SEARCH_REC_URL` | `http://search-rec:3001` (내부 DNS, 서비스명) |

> Railway v3+: 같은 프로젝트 내 서비스는 **서비스명으로 DNS 해석** (`http://search-rec:3001`).

## 6. 마이그레이션 + 시드

```bash
# 마이그레이션 (로컬 SQL 파일 → railway psql stdin 파이프)
bash scripts/deploy-migrate.sh

# 시드 데이터 (상품 10개 + 임베딩)
railway run --service search-rec bash scripts/deploy-seed.sh
```

## 7. 배포 검증

```bash
# health check
curl https://<project>.up.railway.app/api/health

# R: 추천 검증
curl "https://<project>.up.railway.app/api/recommend/home?userId=550e8400-e29b-41d4-a716-446655440000&topK=3"

# B: 생성 검증
railway run --service search-rec "pnpm --filter @ai/ai-gen-app seed"
railway run --service Postgres "psql \$DATABASE_URL -c 'SELECT status FROM generated_contents'"
```

## 8. Vercel 배포 (apps/web)

```bash
# 1. Vercel 대시보드 > New Project > GitHub repo 연결
# 2. Root Directory: apps/web
# 3. Framework: Next.js (자동 감지, apps/web/vercel.json 읽음)
# 4. Environment Variables:
#    SEARCH_REC_URL = <railway-api-public-url>
#    DATABASE_URL   = <railway-postgres-public-url>
# 5. Deploy
```

## Railway 서비스 프로젝트 내 DNS

```
postgres     → DATABASE_URL 자동 주입
redis        → REDIS_URL 자동 주입
api          → http://api:3000 (내부 DNS)
search-rec   → http://search-rec:3001 (내부 DNS)
ai-gen       → worker (consumer, HTTP 포트 없음 /health는 내부용)
```

## ⚠️ 무료 티어 주의사항

- Railway: 5분 비활성 시 sleep → 첫 요청 30초~1분 지연
- Vercel Hobby: 월 100GB 대역폭, 상업 배포 불가
- `railway up --detach` 로 배포 시 sleep 모드 활성화 로그 확인
