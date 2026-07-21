// 이 스키마의 책임: AI 생성물 계약 — 생성·검증·노출 상태를 단일 출처로 정의
import { z } from 'zod';

export const GeneratedContentStatus = {
  DRAFT: 'draft',
  VERIFIED: 'verified',
  PUBLISHED: 'published',
  REJECTED: 'rejected',
} as const;
export type GeneratedContentStatus = (typeof GeneratedContentStatus)[keyof typeof GeneratedContentStatus];

export const GeneratedContentType = {
  DESCRIPTION: 'description',
  MARKETING_COPY: 'marketing_copy',
  SUMMARY: 'summary',
} as const;
export type GeneratedContentType = (typeof GeneratedContentType)[keyof typeof GeneratedContentType];

export const BANNED_WORDS: readonly string[] = [
  'fake', '거짓', '사기',
];

export const GeneratedContentSchema = z.object({
  contentType: z.enum(['description', 'marketing_copy', 'summary']),
  title: z.string().min(5, 'title must be at least 5 characters').max(100),
  body: z.string().min(20, 'body must be at least 20 characters').max(2000),
  keywords: z.array(z.string().max(20)).max(10).default([]),
  bannedWordsChecked: z.literal(true, { message: 'bannedWordsChecked must be true' }),
  language: z.enum(['ko', 'en']),
  confidence: z.number().min(0).max(1),
});

export type GeneratedContent = z.infer<typeof GeneratedContentSchema>;

export const generatedContentValidatedField: keyof GeneratedContent = 'body';

export const GeneratedContentDbSchema = z.object({
  id: z.number().int().positive().optional(),
  contentKey: z.string().min(1).max(100),
  sourceEventId: z.string().uuid(),
  aggregateId: z.string().min(1).max(100),
  contentType: z.enum(['description', 'marketing_copy', 'summary']),
  rawOutput: z.record(z.unknown()),
  validated: GeneratedContentSchema.nullable().optional(),
  status: z.enum(['draft', 'verified', 'published', 'rejected']),
  rejectionReason: z.string().nullable().optional(),
  needsHumanReview: z.boolean().default(false),
  tokenCount: z.number().int().nonnegative().default(0),
  provider: z.string().min(1).max(50),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type GeneratedContentDb = z.infer<typeof GeneratedContentDbSchema>;

export const ContentStatusChangedEventSchema = z.object({
  eventId: z.string().uuid(),
  contentId: z.number().int().positive(),
  aggregateId: z.string().min(1).max(100),
  fromStatus: z.enum(['draft', 'verified', 'published', 'rejected']).nullable(),
  toStatus: z.enum(['draft', 'verified', 'published', 'rejected']),
  reason: z.string().optional(),
  occurredAt: z.string().datetime({ offset: true }),
});

export type ContentStatusChangedEvent = z.infer<typeof ContentStatusChangedEventSchema>;
