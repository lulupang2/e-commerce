-- ============================================================
-- 002-product-views.sql
-- search-rec 추천 모듈: 인기도(population) 신호용 뷰 카운트
-- ============================================================

CREATE TABLE IF NOT EXISTS product_views (
  product_id  BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  view_count  BIGINT NOT NULL DEFAULT 0,
  sale_count  BIGINT NOT NULL DEFAULT 0,
  UNIQUE(product_id)
);

-- 인기도 정규화용 함수: log-scaling + 뷰/판매 가중
-- (popularity.repository.ts 의 SQL과 같은 공식 사용)
COMMENT ON TABLE product_views IS '추천 popularity 신호용 — 조회수·판매수 집계';
