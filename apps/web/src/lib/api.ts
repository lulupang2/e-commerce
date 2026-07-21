import {
  RecommendResponseSchema,
  SearchResponseSchema,
  type RecommendResponse,
  type SearchResponse,
} from '@shared/schemas';
import type { z, ZodTypeAny } from 'zod';

const BASE = process.env['SEARCH_REC_URL'];
if (!BASE) throw new Error('SEARCH_REC_URL is required (.env.local, see .env.example)');

// MSA 응답 맹신 금지 — safeParse 실패 시 throw (페이지의 try/catch가 폼백 UI 렌더링)
// z.output<S>: .default()/.preprocess() 로 input≠output 인 스키마의 출력 타입을 정확히 추론
async function fetchJSON<S extends ZodTypeAny>(url: string, schema: S): Promise<z.output<S>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`upstream ${res.status}: ${res.statusText}`);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`schema mismatch: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  return parsed.data;
}

export function getRecommendHome(userId: string, topK = 10): Promise<RecommendResponse> {
  const qs = new URLSearchParams({ userId, topK: String(topK) });
  return fetchJSON(`${BASE}/recommend/home?${qs}`, RecommendResponseSchema);
}

export function getRecommendRelated(productId: number, topK = 6): Promise<RecommendResponse> {
  const qs = new URLSearchParams({ productId: String(productId), topK: String(topK) });
  return fetchJSON(`${BASE}/recommend/related?${qs}`, RecommendResponseSchema);
}

export function searchProducts(query: string, topK = 20): Promise<SearchResponse> {
  const qs = new URLSearchParams({ q: query, topK: String(topK) });
  return fetchJSON(`${BASE}/search?${qs}`, SearchResponseSchema);
}
