// 이 스키마의 책임: 이벤트 계약 — 버전/멱등/디버깅 봉투(BaseEvent) + 도메인 이벤트 페이로드
import { z } from 'zod';
import { ProductSchema } from './product';

// ---- 이벤트명 상수 (단일 출처) ---------------------------------------------

export const EVENT_NAMES = {
  PRODUCT_CREATED: 'product.created',
  REVIEW_ACCUMULATED: 'review.accumulated',
} as const;
export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];

// ---- BaseEvent 봉투 (스키마 진화·멱등·디버깅) -------------------------------

export const BaseEventSchema = z.object({
  schemaVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'schemaVersion must be semver (MAJOR.MINOR.PATCH)'),
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  aggregateId: z.string().min(1, 'aggregateId must not be empty'),
  eventName: z.string(),
});

/** @see {@link BaseEventSchema} */
export type BaseEvent = z.infer<typeof BaseEventSchema>;

// ---- ProductCreated 이벤트 -------------------------------------------------

export const ProductCreatedEventSchema = BaseEventSchema.extend({
  eventName: z.literal(EVENT_NAMES.PRODUCT_CREATED),
  payload: ProductSchema,
});

/** @see {@link ProductCreatedEventSchema} */
export type ProductCreatedEvent = z.infer<typeof ProductCreatedEventSchema>;

// ---- ReviewAccumulated 이벤트 -----------------------------------------------

export const ReviewAccumulatedEventSchema = BaseEventSchema.extend({
  eventName: z.literal(EVENT_NAMES.REVIEW_ACCUMULATED),
  payload: z.object({
    productId: z.number().int().positive(),
    avgRating: z
      .number()
      .min(0, 'avgRating must be >= 0')
      .max(5, 'avgRating must be <= 5'),
    reviewCount: z.number().int().min(0, 'reviewCount must be >= 0'),
  }),
});

/** @see {@link ReviewAccumulatedEventSchema} */
export type ReviewAccumulatedEvent = z.infer<typeof ReviewAccumulatedEventSchema>;
