// 이 모듈의 책임: search-rec NestJS 동적 모듈 — pgvector·Redis·임베딩 프로바이더를 조립
import { Module, DynamicModule, Provider } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { PGVECTOR_DIM } from '@shared/schemas';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { ProductVectorRepository } from './product-vector.repository';
import { SearchCacheService } from './search-cache.service';
import { EmbeddingProvider } from './embedding/embedding.interface';
import { DummyEmbeddingProvider } from './embedding/dummy.provider';
import { RecommendController } from './recommend/recommend.controller';
import { RecommendService } from './recommend/recommend.service';
import { ReasonService } from './recommend/reason.service';
import { RecommendCacheService } from './recommend/recommend-cache.service';
import { PopularityRepository } from './recommend/popularity.repository';

export interface SearchRecModuleOptions {
  pgPool: Pool;
  redis: Redis;
  vectorDim?: number;
  similarityThreshold?: number;
  cacheTtlSeconds?: number;
  /** 주입할 EmbeddingProvider. 미지정 시 DummyEmbeddingProvider 사용 */
  embeddingProvider?: EmbeddingProvider;
}

@Module({})
export class SearchRecModule {
  static forRoot(options: SearchRecModuleOptions): DynamicModule {
    const vectorDim = options.vectorDim ?? PGVECTOR_DIM;
    const threshold = options.similarityThreshold ?? 0.7;
    const ttl = options.cacheTtlSeconds ?? 300;

    const embeddingProvider: Provider = {
      provide: EmbeddingProvider,
      useValue: options.embeddingProvider ?? new DummyEmbeddingProvider(vectorDim),
    };

    const providers: Provider[] = [
      {
        provide: ProductVectorRepository,
        useFactory: (pgPool: Pool) => new ProductVectorRepository(pgPool),
        inject: ['PG_POOL'],
      },
      {
        provide: PopularityRepository,
        useFactory: (pgPool: Pool) => new PopularityRepository(pgPool),
        inject: ['PG_POOL'],
      },
      {
        provide: SearchCacheService,
        useFactory: (redis: Redis) => new SearchCacheService(redis, ttl),
        inject: ['REDIS_CLIENT'],
      },
      {
        provide: RecommendCacheService,
        useFactory: (redis: Redis) => new RecommendCacheService(redis),
        inject: ['REDIS_CLIENT'],
      },
      {
        provide: ReasonService,
        useClass: ReasonService,
      },
      embeddingProvider,
      {
        provide: SearchService,
        useFactory: (
          repo: ProductVectorRepository,
          embedder: EmbeddingProvider,
          cache: SearchCacheService,
        ) => new SearchService(repo, embedder, cache, threshold),
        inject: [ProductVectorRepository, EmbeddingProvider, SearchCacheService],
      },
      {
        provide: RecommendService,
        useFactory: (
          vectorRepo: ProductVectorRepository,
          popularityRepo: PopularityRepository,
          reasonService: ReasonService,
          cache: RecommendCacheService,
        ) => new RecommendService(vectorRepo, popularityRepo, reasonService, cache),
        inject: [
          ProductVectorRepository,
          PopularityRepository,
          ReasonService,
          RecommendCacheService,
        ],
      },
      { provide: 'PG_POOL', useValue: options.pgPool },
      { provide: 'REDIS_CLIENT', useValue: options.redis },
    ];

    return {
      module: SearchRecModule,
      controllers: [SearchController, RecommendController],
      providers,
      exports: [
        SearchService,
        RecommendService,
        ProductVectorRepository,
        SearchCacheService,
        RecommendCacheService,
        EmbeddingProvider,
      ],
    };
  }
}
