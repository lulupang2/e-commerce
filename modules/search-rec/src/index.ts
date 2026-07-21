// 이 파일의 책임: @search/search-rec 배럴 — SearchRecModule 및 모든 공개 프로바이더를 re-export
import { PGVECTOR_DIM } from '@shared/schemas';
import { EmbeddingProvider } from './embedding/embedding.interface';
import { DummyEmbeddingProvider } from './embedding/dummy.provider';
import { HttpEmbeddingProvider } from './embedding/http.provider';
export { SearchRecModule, type SearchRecModuleOptions } from './search-rec.module';
export { SearchService } from './search.service';
export { ProductVectorRepository } from './product-vector.repository';
export { SearchCacheService } from './search-cache.service';
export { EmbeddingProvider } from './embedding/embedding.interface';
export { DummyEmbeddingProvider } from './embedding/dummy.provider';
export { HttpEmbeddingProvider } from './embedding/http.provider';
export {
  SearchQuerySchema,
  SearchResultItemSchema,
  SearchResponseSchema,
  type SearchQuery,
  type SearchResultItem,
  type SearchResponse,
} from './search.dto';

export { RecommendService } from './recommend/recommend.service';
export { ReasonService, type LLmReasonProvider } from './recommend/reason.service';
export { RecommendCacheService } from './recommend/recommend-cache.service';
export { PopularityRepository } from './recommend/popularity.repository';
export { RecommendConfig } from './recommend/recommend.config';
export {
  HomeRecommendQuerySchema,
  RelatedRecommendQuerySchema,
  type HomeRecommendQuery,
  type RelatedRecommendQuery,
} from './recommend/recommend.dto';

/** 더미 프로바이더 팩토리 (env 없이 즉시 사용) */
export function createDummyEmbeddingProvider(dim = PGVECTOR_DIM): EmbeddingProvider {
  return new DummyEmbeddingProvider(dim);
}

/** HTTP 프로바이더 팩토리 (OpenAI 호환 API) — env 기본값 */
export function createHttpEmbeddingProvider(
  baseUrl = process.env['EMBEDDING_BASE_URL'] ?? '',
  apiKey = process.env['EMBEDDING_API_KEY'] ?? '',
  model = process.env['EMBEDDING_MODEL'] ?? 'text-embedding-3-small',
): EmbeddingProvider {
  return new HttpEmbeddingProvider(baseUrl, apiKey, model);
}
