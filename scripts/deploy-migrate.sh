#!/usr/bin/env bash
# deploy-migrate.sh — Railway Postgres 마이그레이션 (파이프로 로컬 SQL 파일 전송)
# 용법: bash scripts/deploy-migrate.sh
set -euo pipefail

echo "=== running migrations ==="

cat apps/search-rec/migrations/001-products-search.sql | railway run --service Postgres psql
cat apps/search-rec/migrations/002-product-views.sql    | railway run --service Postgres psql
cat apps/ai-gen/migrations/001-generated-content.sql    | railway run --service Postgres psql
cat apps/ai-gen/migrations/004-verified-at.sql          | railway run --service Postgres psql

echo "=== migrations complete ==="
