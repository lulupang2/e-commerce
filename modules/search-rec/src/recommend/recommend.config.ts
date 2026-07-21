// 이 파일의 책임: 추천 신호 조합 가중치·임계값·기본값의 단일 상수 출처
export const RecommendConfig = {
  WEIGHTS: {
    SEMANTIC: 0.5,
    POPULARITY: 0.3,
    AFFINITY: 0.2,
  },
  COLD_START: {
    DEFAULT_CATEGORY: '전체',
    USER_WEIGHTS: { SEMANTIC: 0.0, POPULARITY: 0.8, AFFINITY: 0.2 },
    PRODUCT_WEIGHTS: { SEMANTIC: 0.9, POPULARITY: 0.1, AFFINITY: 0.0 },
  },
  CACHE: {
    HOME_TTL_SECONDS: 600,
    RELATED_TTL_SECONDS: 3600,
  },
  DEFAULT_TOP_K: 10,
  LOOKBACK_DAYS: 30,
} as const;
