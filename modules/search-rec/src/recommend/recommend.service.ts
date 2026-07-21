// 이 서비스의 책임: 신호 조합·정규화·콜드스타트 분기·topK 추천 (DRY: 벡터검색은 ProductVectorRepository 재사용)
import { Injectable, Logger } from '@nestjs/common';
import { RecommendConfig } from './recommend.config';
import {
  ProductVectorRepository,
  type SemanticSearchRow,
} from '../product-vector.repository';
import { PopularityRepository } from './popularity.repository';
import { ReasonService } from './reason.service';
import { RecommendCacheService } from './recommend-cache.service';
import {
  type RecommendSignals,
  type RecommendResponse,
} from '@shared/schemas';

interface ScoreMap {
  semantic: Map<number, number>;
  popularity: Map<number, number>;
  affinity: Map<number, number>;
}

interface UserProfile {
  preferredCategory?: string;
  interestEmbedding?: number[];
}

interface ReasonContext {
  category: string;
  isColdStart: boolean;
  isColdStartProduct: boolean;
  seedProductName?: string;
}

@Injectable()
export class RecommendService {
  private readonly logger = new Logger(RecommendService.name);

  constructor(
    private readonly vectorRepo: ProductVectorRepository,
    private readonly popularityRepo: PopularityRepository,
    private readonly reasonService: ReasonService,
    private readonly cache: RecommendCacheService,
  ) {}

  // ---- 홈 추천 (사용자별) ---------------------------------------------------

  async recommendHome(userId: string, topK: number): Promise<RecommendResponse> {
    const startedAt = Date.now();
    const signalVersion = await this.cache.getSignalVersion(userId);

    const cached = await this.cache.getHome(userId, signalVersion);
    if (cached) {
      return { ...cached, tookMs: Date.now() - startedAt };
    }

    const profile = await this.getUserProfile(userId);
    const isColdStart = profile === null;

    const { scoreMap, productMap } = await this.buildScoreMap(profile, topK * 3, isColdStart);
    const weights = isColdStart
      ? RecommendConfig.COLD_START.USER_WEIGHTS
      : RecommendConfig.WEIGHTS;
    const ranked = this.combineScores(scoreMap, weights, topK);
    const items = this.buildItems(ranked, scoreMap, productMap, weights, {
      category: profile?.preferredCategory ?? RecommendConfig.COLD_START.DEFAULT_CATEGORY,
      isColdStart,
      isColdStartProduct: false,
    });

    const response: RecommendResponse = {
      items,
      source: isColdStart ? 'cold_start_user' : 'personalized',
      tookMs: Date.now() - startedAt,
    };

    await this.cache.setHome(userId, signalVersion, response);
    return response;
  }

  // ---- 관련 상품 추천 --------------------------------------------------------

  async recommendRelated(productId: number, topK: number): Promise<RecommendResponse> {
    const startedAt = Date.now();

    const cached = await this.cache.getRelated(productId, topK);
    if (cached) {
      return { ...cached, tookMs: Date.now() - startedAt };
    }

    const embedding = await this.vectorRepo.getProductEmbedding(productId);
    if (!embedding) {
      // 상품에 embedding 없으면 인기도 기반 폰백
      const fallbackIds = await this.popularityRepo.getTopPopular(topK);
      const fallbackRows = await this.vectorRepo.getProductsByIds(fallbackIds);
      const items: RecommendResponse['items'] = fallbackRows.map((row) => {
        const signals: RecommendSignals = {
          semantic: 0,
          popularity: 0,
          affinity: 0,
          combined: 0,
        };
        return {
          id: row.id,
          uuid: row.uuid,
          sku: row.sku,
          name: row.name,
          description: row.description ?? undefined,
          price: row.price,
          currency: row.currency,
          stock: row.stock,
          status: row.status,
          metadata: row.metadata,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          reason: this.reasonService.generate(
            row.name,
            '전체',
            signals,
            true,
            undefined,
          ),
          signals,
        };
      });

      const response: RecommendResponse = {
        items,
        source: 'cold_start_product',
        tookMs: Date.now() - startedAt,
      };
      await this.cache.setRelated(productId, topK, response);
      return response;
    }

    const candidates = await this.vectorRepo.semanticSearch(embedding, topK * 3);
    const relatedIds = candidates.filter((c) => c.id !== productId).map((c) => c.id);

    if (relatedIds.length === 0) {
      const response: RecommendResponse = {
        items: [],
        source: 'cold_start_product',
        tookMs: Date.now() - startedAt,
      };
      return response;
    }

    const popularityScores = await this.popularityRepo.getScores(relatedIds);
    const scoreMap: ScoreMap = {
      semantic: new Map(),
      popularity: new Map(),
      affinity: new Map(),
    };

    const productMap = new Map<number, SemanticSearchRow>();
    for (const row of candidates) {
      if (row.id === productId) continue;
      productMap.set(row.id, row);
      scoreMap.semantic.set(row.id, row.similarity);
      scoreMap.popularity.set(row.id, this.normalizePop(popularityScores.get(row.id)));
      scoreMap.affinity.set(row.id, 0);
    }

    const isColdStart = candidates.length < 3;
    const weights = isColdStart
      ? RecommendConfig.COLD_START.PRODUCT_WEIGHTS
      : { ...RecommendConfig.WEIGHTS, AFFINITY: 0 };

    const ranked = this.combineScores(scoreMap, weights, topK);
    const seedProductName = candidates.find((c) => c.id === productId)?.name;

    const items = this.buildItems(ranked, scoreMap, productMap, weights, {
      category: '전체',
      isColdStart,
      isColdStartProduct: true,
      seedProductName,
    });

    const response: RecommendResponse = {
      items,
      source: isColdStart ? 'cold_start_product' : 'personalized',
      tookMs: Date.now() - startedAt,
    };

    await this.cache.setRelated(productId, topK, response);
    return response;
  }

  // ---- Score Map Build -------------------------------------------------------

  private async buildScoreMap(
    profile: UserProfile | null,
    candidateTopK: number,
    isColdStart: boolean,
  ): Promise<{ scoreMap: ScoreMap; productMap: Map<number, SemanticSearchRow> }> {
    const scoreMap: ScoreMap = {
      semantic: new Map(),
      popularity: new Map(),
      affinity: new Map(),
    };
    const productMap = new Map<number, SemanticSearchRow>();

    if (isColdStart) {
      const ids = await this.popularityRepo.getTopPopular(
        candidateTopK,
        RecommendConfig.COLD_START.DEFAULT_CATEGORY,
      );
      const popScores = await this.popularityRepo.getScores(ids);
      const rows = await this.vectorRepo.getProductsByIds(ids);
      for (const row of rows) {
        productMap.set(row.id, row);
        scoreMap.popularity.set(row.id, this.normalizePop(popScores.get(row.id)));
      }
      return { scoreMap, productMap };
    }

    // 정상 사용자: semantic (벡터검색) + popularity + affinity
    const seedEmbedding = profile!.interestEmbedding;
    if (seedEmbedding && seedEmbedding.length > 0) {
      const results = await this.vectorRepo.semanticSearch(seedEmbedding, candidateTopK);
      for (const row of results) {
        productMap.set(row.id, row);
        scoreMap.semantic.set(row.id, row.similarity);
      }
    }

    const allIds = [...productMap.keys()];
    if (allIds.length > 0) {
      const popScores = await this.popularityRepo.getScores(allIds);
      for (const id of allIds) {
        scoreMap.popularity.set(id, this.normalizePop(popScores.get(id)));
      }
    }

    // affinity: 선호 카테고리 일치 시 1.0, 불일치 0.0
    if (profile?.preferredCategory) {
      for (const id of allIds) {
        const row = productMap.get(id);
        const category = this.extractCategory(row?.metadata);
        scoreMap.affinity.set(id, category === profile.preferredCategory ? 1.0 : 0.0);
      }
    }

    return { scoreMap, productMap };
  }

  private combineScores(
    scoreMap: ScoreMap,
    weights: { SEMANTIC: number; POPULARITY: number; AFFINITY: number },
    topK: number,
  ): number[] {
    const totals = new Map<number, number>();
    const allIds = new Set([
      ...scoreMap.semantic.keys(),
      ...scoreMap.popularity.keys(),
      ...scoreMap.affinity.keys(),
    ]);

    for (const id of allIds) {
      const s = scoreMap.semantic.get(id) ?? 0;
      const p = scoreMap.popularity.get(id) ?? 0;
      const a = scoreMap.affinity.get(id) ?? 0;
      totals.set(id, s * weights.SEMANTIC + p * weights.POPULARITY + a * weights.AFFINITY);
    }

    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id]) => id);
  }

  // ---- Item Build (productMap lookup → full RecommendResultItem) -------------

  private buildItems(
    rankedIds: number[],
    scoreMap: ScoreMap,
    productMap: Map<number, SemanticSearchRow>,
    weights: { SEMANTIC: number; POPULARITY: number; AFFINITY: number },
    ctx: ReasonContext,
  ): RecommendResponse['items'] {
    const items: RecommendResponse['items'] = [];

    for (const id of rankedIds) {
      const row = productMap.get(id);
      if (!row) continue;

      const sem = scoreMap.semantic.get(id) ?? 0;
      const pop = scoreMap.popularity.get(id) ?? 0;
      const aff = scoreMap.affinity.get(id) ?? 0;

      const signals: RecommendSignals = {
        semantic: round4(sem),
        popularity: round4(pop),
        affinity: round4(aff),
        combined: round4(
          sem * weights.SEMANTIC +
          pop * weights.POPULARITY +
          aff * weights.AFFINITY,
        ),
      };

      const reason = this.reasonService.generate(
        row.name,
        ctx.category,
        signals,
        ctx.isColdStart,
        ctx.seedProductName,
      );

      items.push({
        id: row.id,
        uuid: row.uuid,
        sku: row.sku,
        name: row.name,
        description: row.description ?? undefined,
        price: row.price,
        currency: row.currency,
        stock: row.stock,
        status: row.status,
        metadata: row.metadata,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        reason,
        signals,
      });
    }

    return items;
  }

  // ---- Helpers ---------------------------------------------------------------

  private extractCategory(metadata: Record<string, unknown> | undefined): string | undefined {
    if (!metadata) return undefined;
    const category = metadata['category'];
    return typeof category === 'string' ? category : undefined;
  }

  private normalizePop(score: number | undefined): number {
    if (score === undefined || score <= 0) return 0;
    return Math.min(1, score / 8);
  }

  private zeroSignals(): RecommendSignals {
    return { semantic: 0, popularity: 0, affinity: 0, combined: 0 };
  }

  private async getUserProfile(_userId: string): Promise<UserProfile | null> {
    // TODO: 사용자 도메인 모듈에서 프로필 조회
    // 현재: 콜드스타트 시뮬레이션을 위해 null 반환
    return null;
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
