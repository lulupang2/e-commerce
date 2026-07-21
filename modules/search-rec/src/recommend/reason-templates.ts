// 이 파일의 책임: 규칙 기반 reason 문구 템플릿 (결정론 — 동일 입력 → 동일 출력)
const TEMPLATES = {
  SEMANTIC_SIMILAR: (productName: string) =>
    `"${productName}"와(과) 유사한 상품입니다`,

  POPULAR_TOP: (category: string, percentile: string) =>
    `"${category}" 카테고리에서 인기 상위 ${percentile}%입니다`,

  AFFINITY_CATEGORY: (category: string) =>
    `최근 관심을 보이신 "${category}" 카테고리의 추천입니다`,

  SEMANTIC_POPULAR_MIX: (productName: string, category: string) =>
    `"${productName}"와(과) 유사하며 "${category}" 카테고리에서 인기 있는 상품입니다`,

  COLD_START_USER: () =>
    '인기 상품을 소개합니다 (사용자 정보가 아직 충분하지 않습니다)',

  COLD_START_PRODUCT: (productName: string) =>
    `"${productName}"와(과) 유사한 신상품입니다 (따뜻한 관심 부탁드립니다)`,
} as const;

export type ReasonCode = keyof typeof TEMPLATES;

export function getReasonTemplate(code: ReasonCode): (...args: string[]) => string {
  return (TEMPLATES as Record<string, (...args: string[]) => string>)[code];
}
