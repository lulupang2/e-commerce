// 이 서비스의 책임: 벡터 검색 → 임계치 미달/예외 시 trgm 폴백 → 결과 캐싱
import { Injectable, Logger } from '@nestjs/common';
import { ProductVectorRepository, SemanticSearchRow } from './product-vector.repository';
import { SearchCacheService } from './search-cache.service';
import { EmbeddingProvider } from './embedding/embedding.interface';
import { SearchResultItemSchema, type SearchResponse } from './search.dto';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly repo: ProductVectorRepository,
    private readonly embedder: EmbeddingProvider,
    private readonly cache: SearchCacheService,
    private readonly threshold: number = 0.7,
  ) {}

  async search(query: string, topK: number): Promise<SearchResponse> {
    const startedAt = Date.now();

    const cached = await this.cache.get<SearchResponse>(query, topK);
    if (cached) {
      return { ...cached, tookMs: Date.now() - startedAt };
    }

    const embedding = await this.embedder.embed(query);

    let rows: SemanticSearchRow[];
    let source: 'vector' | 'trgm_fallback' = 'vector';

    try {
      const results = await this.repo.semanticSearch(embedding, topK);
      const maxSimilarity = results.length > 0 ? results[0].similarity : 0;

      if (maxSimilarity >= this.threshold) {
        rows = results;
      } else {
        this.logger.warn(
          `Vector similarity below threshold (max=${maxSimilarity.toFixed(4)} < ${this.threshold}), ` +
          `falling back to trgm for query "${query.slice(0, 80)}"`,
        );
        rows = await this.repo.trgmSearch(query, topK);
        source = 'trgm_fallback';
      }
    } catch (err) {
      this.logger.warn(
        `Vector search exception: ${(err as Error).message} — falling back to trgm for query "${query.slice(0, 80)}"`,
      );
      try {
        rows = await this.repo.trgmSearch(query, topK);
        source = 'trgm_fallback';
      } catch (trgmErr) {
        this.logger.error(
          `Both vector and trgm fallback failed for query "${query.slice(0, 80)}": ${
            (trgmErr as Error).message
          }`,
        );
        throw new Error('Search unavailable: both vector and fallback failed');
      }
    }

    const tookMs = Date.now() - startedAt;

    const items = rows.map((row) => SearchResultItemSchema.parse(row));

    if (source === 'vector') {
      await this.cache.set(query, topK, { items, source, tookMs });
    }

    return { items, source, tookMs };
  }
}
