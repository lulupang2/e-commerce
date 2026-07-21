// 이 파일의 책임: 검색 쿼리·응답의 zod DTO — 쿼리 파라미터는 로컬, 응답 스키마는 SSOT(shared) 사용
import { z } from 'zod';
import {
  SearchResultItemSchema,
  SearchResponseSchema,
  type SearchResultItem,
  type SearchResponse,
} from '@shared/schemas';

export { SearchResultItemSchema, SearchResponseSchema, type SearchResultItem, type SearchResponse };

export const SearchQuerySchema = z.object({
  q: z.string().min(1, 'query must not be empty').max(500),
  topK: z.coerce.number().int().min(1).max(100).default(20),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
