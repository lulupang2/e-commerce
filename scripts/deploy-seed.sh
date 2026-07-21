#!/usr/bin/env bash
# deploy-seed.sh — 시드 데이터 적재
# 용법: railway run --service search-rec bash scripts/deploy-seed.sh
set -euo pipefail

echo "=== running seed ==="
pnpm --filter @search/search-rec-app seed
echo "=== seed complete ==="
