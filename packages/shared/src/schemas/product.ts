// 이 스키마의 책임: Product 도메인 불변식 (재고≥0, 가격≥0, 통화 ISO-3, pgvector 임베딩)
import { z } from 'zod';

export const PGVECTOR_DIM = 1536;

export const ProductStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  SOLD_OUT: 'SOLD_OUT',
  ARCHIVED: 'ARCHIVED',
} as const;

/** Product 기본 스키마 — .extend() 용으로 superRefine 이전 분리 */
export const ProductBaseSchema = z.object({
  id: z.number().int().positive().optional(),
  uuid: z.string().uuid(),
  sku: z.string().min(1, 'sku must not be empty'),
  name: z.string().min(1, 'name must not be empty'),
  description: z.string().optional(),
  price: z.number().min(0, 'price must be >= 0'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be ISO 4217 (3 capital letters)'),
  stock: z.number().int().min(0, 'stock must be >= 0'),
  status: z.enum(['DRAFT', 'ACTIVE', 'SOLD_OUT', 'ARCHIVED']),
  // pgvector 용 임베딩 — OpenAI text-embedding-3-small 기본 1536차원
  embedding: z.array(z.number()).optional(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

/** Product 스키마 — 기본 불변식 + embedding 차수 refine */
export const ProductSchema = ProductBaseSchema.superRefine((product, ctx) => {
  if (product.embedding !== undefined && product.embedding.length !== PGVECTOR_DIM) {
    ctx.addIssue({
      code: 'custom',
      message: `embedding dimension must be ${PGVECTOR_DIM}, got ${product.embedding.length}`,
      path: ['embedding'],
    });
  }
});

/** @see {@link ProductSchema} — zod 추론 타입 */
export type Product = z.infer<typeof ProductSchema>;
