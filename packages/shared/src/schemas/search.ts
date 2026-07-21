// 이 스키마의 책임: 검색 응답 계약 — 모든 서비스(BFF 포함)가 검증 용도로 import
import { z } from 'zod';
import { ProductBaseSchema } from './product';

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
