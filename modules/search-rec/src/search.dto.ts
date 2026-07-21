// 이 파일의 책임: 검색 쿼리·응답의 zod DTO — 파라미터 검증 + 응답 직렬화 스키마
import { z } from 'zod';
import { ProductBaseSchema } from '@shared/schemas';

export const SearchQuerySchema = z.object({
  q: z.string().min(1, 'query must not be empty').max(500),
  topK: z.coerce.number().int().min(1).max(100).default(20),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/** DB 행 변환: PG SQL NULL → undefined (Zod optional 호환) */
function nullsToUndefined(val: unknown): unknown {
  if (val === null || typeof val !== 'object' || Array.isArray(val)) return val;
  const obj = { ...(val as Record<string, unknown>) };
  for (const [k, v] of Object.entries(obj)) {
    if (v === null) delete obj[k];
  }
  return obj;
}

export const SearchResultItemSchema = z.preprocess(
  nullsToUndefined,
  ProductBaseSchema.extend({
    similarity: z.number(),
  }),
);
export type SearchResultItem = z.infer<typeof SearchResultItemSchema>;

export const SearchResponseSchema = z.object({
  items: z.array(SearchResultItemSchema),
  source: z.enum(['vector', 'trgm_fallback']),
  tookMs: z.number().int().nonnegative(),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
