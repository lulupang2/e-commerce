// 이 파일의 책임: @shared/schemas 배럴 — 모든 도메인 스키마·타입·이벤트 계약을 단일 진입점으로 re-export
export {
  ProductBaseSchema,
  ProductSchema,
  ProductStatus,
  PGVECTOR_DIM,
  type Product,
} from './schemas/product';

export {
  OrderItemSchema,
  OrderSchema,
  OrderStatus,
  type OrderItem,
  type Order,
} from './schemas/order';

export {
  EVENT_NAMES,
  BaseEventSchema,
  ProductCreatedEventSchema,
  ReviewAccumulatedEventSchema,
  type EventName,
  type BaseEvent,
  type ProductCreatedEvent,
  type ReviewAccumulatedEvent,
} from './schemas/events';

export {
  RecommendSignalsSchema,
  RecommendResultItemSchema,
  RecommendResponseSchema,
  HomeRecommendQuerySchema,
  RelatedRecommendQuerySchema,
  type RecommendSignals,
  type RecommendResultItem,
  type RecommendResponse,
  type HomeRecommendQuery,
  type RelatedRecommendQuery,
} from './schemas/recommend';

export {
  GeneratedContentSchema,
  BANNED_WORDS,
  GeneratedContentStatus,
  GeneratedContentType,
  generatedContentValidatedField,
  GeneratedContentDbSchema,
  ContentStatusChangedEventSchema,
  type GeneratedContent,
  type GeneratedContentDb,
  type ContentStatusChangedEvent,
} from './schemas/generated-content';
