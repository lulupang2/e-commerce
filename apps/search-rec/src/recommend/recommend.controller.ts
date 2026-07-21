// 이 컨트롤러의 책임: GET /recommend/home·/recommend/related + POST invalidation hook
import { Controller, Get, Post, Query, Body, BadRequestException, Inject } from '@nestjs/common';
import { RecommendService } from './recommend.service';
import { RecommendCacheService } from './recommend-cache.service';
import {
  HomeRecommendQuerySchema,
  RelatedRecommendQuerySchema,
  type HomeRecommendQuery,
  type RelatedRecommendQuery,
} from './recommend.dto';
import { RecommendResponseSchema } from '@shared/schemas';

@Controller('recommend')
export class RecommendController {
  constructor(
    @Inject(RecommendService) private readonly recommendService: RecommendService,
    @Inject(RecommendCacheService) private readonly cache: RecommendCacheService,
  ) {}

  @Get('home')
  async home(@Query() raw: Record<string, unknown>) {
    const parsed = HomeRecommendQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid recommend query',
        errors: parsed.error.flatten(),
      });
    }
    const q: HomeRecommendQuery = parsed.data;
    const result = await this.recommendService.recommendHome(q.userId, q.topK);
    return RecommendResponseSchema.parse(result);
  }

  @Get('related')
  async related(@Query() raw: Record<string, unknown>) {
    const parsed = RelatedRecommendQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid related recommend query',
        errors: parsed.error.flatten(),
      });
    }
    const q: RelatedRecommendQuery = parsed.data;
    const result = await this.recommendService.recommendRelated(q.productId, q.topK);
    return RecommendResponseSchema.parse(result);
  }

  /** 장바구니 추가 / 상품 조회 시 동기 invalidation hook */
  @Post('invalidate-home')
  async invalidateHome(@Body('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId required');
    await this.cache.invalidateHome(userId);
    return { ok: true };
  }
}
