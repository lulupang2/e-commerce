// 이 스키마의 책임: 추천 응답 계약 — 기여 신호 투명성(reason+signals) + ProductSchema 확장
import { z } from 'zod';
import { ProductBaseSchema } from './product';

export const RecommendSignalsSchema = z.object({
  semantic: z.number().min(0).max(1),
  popularity: z.number().min(0).max(1),
  affinity: z.number().min(0).max(1),
  combined: z.number().min(0).max(1),
});
export type RecommendSignals = z.infer<typeof RecommendSignalsSchema>;

export const RecommendResultItemSchema = ProductBaseSchema.extend({
  reason: z.string(),
  signals: RecommendSignalsSchema,
});
export type RecommendResultItem = z.infer<typeof RecommendResultItemSchema>;

export const RecommendResponseSchema = z.object({
  items: z.array(RecommendResultItemSchema),
  source: z.enum(['cold_start_user', 'cold_start_product', 'personalized']),
  tookMs: z.number().int().nonnegative(),
});
export type RecommendResponse = z.infer<typeof RecommendResponseSchema>;

export const HomeRecommendQuerySchema = z.object({
  userId: z.string().uuid(),
  topK: z.coerce.number().int().min(1).max(100).default(10),
});
export type HomeRecommendQuery = z.infer<typeof HomeRecommendQuerySchema>;

export const RelatedRecommendQuerySchema = z.object({
  productId: z.coerce.number().int().positive(),
  topK: z.coerce.number().int().min(1).max(100).default(10),
});
export type RelatedRecommendQuery = z.infer<typeof RelatedRecommendQuerySchema>;
