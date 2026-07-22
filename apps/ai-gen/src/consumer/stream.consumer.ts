// 이 파일의 책임: Redis Stream XREADGROUP 컨슈머 — eventId 멱등, 실패 시 pending 재소비
import { Injectable, Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import {
  BaseEventSchema,
  ProductCreatedEventSchema,
  ReviewAccumulatedEventSchema,
  EVENT_NAMES,
} from '@shared/schemas';
import { GenerationProvider } from '../generation/generation.interface';
import { GuardrailService } from '../guardrail/guardrail.service';
import { ContentRepository } from '../content.repository';

const STREAM_KEY = 'ai:events';
const CONSUMER_GROUP = 'ai-gen-group';
const STREAM_DEDUP_KEY = 'ai:dedup:stream';
const MAX_RETRIES = 5;

const RETRY_DELAYS = [0, 5000, 30000, 120000];

@Injectable()
export class StreamConsumer implements OnModuleDestroy {
  private readonly logger = new Logger(StreamConsumer.name);
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly generator: GenerationProvider,
    private readonly guardrail: GuardrailService,
    private readonly contentRepo: ContentRepository,
  ) {}

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  /** health check용 — 폴 루프 생존 여부 */
  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    this.running = true;
    await this.tryCreateGroup();
    this.poll();
  }

  private async tryCreateGroup(retries = 10, delayMs = 3000): Promise<void> {
    for (let i = 0; i < retries; i++) {
      try {
        await this.redis.xgroup('CREATE', STREAM_KEY, CONSUMER_GROUP, '0', 'MKSTREAM');
        this.logger.log(`Consumer group "${CONSUMER_GROUP}" ready on stream "${STREAM_KEY}"`);
        return;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('BUSYGROUP')) {
          this.logger.log(`Consumer group "${CONSUMER_GROUP}" already exists`);
          return;
        }
        if (i < retries - 1) {
          this.logger.warn(`Redis unavailable (attempt ${i + 1}/${retries}), retrying in ${delayMs}ms...`);
          await new Promise((r) => setTimeout(r, delayMs));
        } else {
          this.logger.error(`Failed to create consumer group after ${retries} attempts: ${msg}`);
          throw err;
        }
      }
    }
  }

  private poll(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => this.consumeBatch(), 1000);
  }

  private async consumeBatch(): Promise<void> {
    try {
      const messages = await this.redis.xreadgroup(
        'GROUP', CONSUMER_GROUP, 'ai-gen-consumer-1',
        'COUNT', 5,
        'BLOCK', 2000,
        'STREAMS', STREAM_KEY, '>',
      ) as null | [string, [string, string[]][]][];

      if (messages) {
        for (const [, items] of messages) {
          for (const [id, fields] of items) {
            await this.handleMessage(id, fields);
          }
        }
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('NOGROUP')) {
        try {
          await this.redis.xgroup('CREATE', STREAM_KEY, CONSUMER_GROUP, '0', 'MKSTREAM');
          this.logger.log('Consumer group recreated after NOGROUP');
        } catch (createErr) { /* retry next poll */ }
      } else {
        this.logger.error(`Consumer loop error: ${msg}`);
      }
    } finally {
      this.poll();
    }
  }

  private parseFields(fields: string[]): Record<string, string> {
    const obj: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      obj[fields[i]] = fields[i + 1];
    }
    return obj;
  }

  private extractRetry(fields: Record<string, string>): number {
    return fields['_retry'] ? parseInt(fields['_retry'], 10) : 0;
  }

  async handleMessage(streamId: string, rawFields: string[]): Promise<void> {
    const fields = this.parseFields(rawFields);

    const dedupKey = await this.redis.setnx(`${STREAM_DEDUP_KEY}:${streamId}`, '1');
    if (dedupKey === 0) {
      await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, streamId);
      return;
    }
    await this.redis.expire(`${STREAM_DEDUP_KEY}:${streamId}`, 86400);

    let eventPayload: unknown;
    try {
      const raw = fields['payload'] ?? '{}';
      eventPayload = JSON.parse(raw);
    } catch {
      this.logger.warn(`Invalid JSON in stream message ${streamId}, skipping`);
      await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, streamId);
      return;
    }

    const eventName = fields['eventName'] ?? '';
    try {
      if (eventName === EVENT_NAMES.PRODUCT_CREATED) {
        await this.handleProductCreated(eventPayload);
      } else if (eventName === EVENT_NAMES.REVIEW_ACCUMULATED) {
        await this.handleReviewAccumulated(eventPayload);
      } else {
        this.logger.debug(`Unknown event "${eventName}", acknowledge and skip`);
      }
      await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, streamId);
    } catch (err) {
      const retry = this.extractRetry(fields);
      this.logger.error(`Processing failed for ${streamId} (retry=${retry}): ${(err as Error).message}`);
      if (retry >= MAX_RETRIES) {
        await this.redis.xadd('ai:dlq', '*', ...rawFields, '_dead_at', new Date().toISOString());
        await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, streamId);
        this.logger.error(`Message ${streamId} moved to DLQ after ${retry} retries`);
      } else {
        // XADD with incremented retry counter (XPENDING will pick this up)
        const delay = RETRY_DELAYS[Math.min(retry, RETRY_DELAYS.length - 1)] ?? 30000;
        await new Promise((r) => setTimeout(r, delay));
        await this.redis.xadd(STREAM_KEY, '*', ...rawFields, '_retry', String(retry + 1));
        await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, streamId);
      }
    }
  }

  private async handleProductCreated(eventPayload: unknown): Promise<void> {
    const parsed = ProductCreatedEventSchema.safeParse(eventPayload);
    if (!parsed.success) { this.logger.warn('Invalid ProductCreatedEvent, skipping'); return; }

    const evt = parsed.data;
    const { payload: product } = evt;
    const productId = product.id;

    if (productId == null) { this.logger.warn('ProductCreatedEvent missing id'); return; }

    const contentKey = `product.description:${String(productId)}`;
    const aggregateId = String(productId);
    const contentType = 'description';

    const existing = await this.contentRepo.findBySourceEventId(evt.eventId);
    if (existing.length > 0) { return; }

    const prompt = this.buildProductPrompt(product);
    await this.generateAndGuard(contentKey, evt.eventId, aggregateId, contentType, prompt);
  }

  private async handleReviewAccumulated(eventPayload: unknown): Promise<void> {
    const parsed = ReviewAccumulatedEventSchema.safeParse(eventPayload);
    if (!parsed.success) { this.logger.warn('Invalid ReviewAccumulatedEvent, skipping'); return; }

    const evt = parsed.data;
    const { payload: review } = evt;
    const aggregateId = String(review.productId);
    const contentType = 'marketing_copy';
    const contentKey = `product.marketing:${review.productId}`;

    const existing = await this.contentRepo.findBySourceEventId(evt.eventId);
    if (existing.length > 0) { return; }

    const prompt = this.buildReviewPrompt(review);
    await this.generateAndGuard(contentKey, evt.eventId, aggregateId, contentType, prompt);
  }

  private async generateAndGuard(
    contentKey: string,
    eventId: string,
    aggregateId: string,
    contentType: string,
    prompt: string,
  ): Promise<void> {
    const inputHash = Buffer.from(eventId + ':' + prompt).toString('hex');

    // 비용 가드레일: 중복 입력 체크
    if (await this.guardrail.isDuplicateInput(inputHash)) {
      this.logger.log(`Skipping duplicate input: ${contentKey}`);
      return;
    }

    const estTokens = GuardrailService.estimateTokens(prompt);
    const budget = await this.guardrail.checkBudget('default', estTokens);
    if (!budget.ok) {
      const draft = await this.contentRepo.insertDraft({
        contentKey, sourceEventId: eventId, aggregateId, contentType,
        rawOutput: { prompt, skipped: 'budget_exceeded' },
        tokenCount: 0, provider: 'budget_limit',
      });
      if (draft) {
        await this.contentRepo.updateStatus(draft.id, 'rejected', null, `Budget exceeded: ${budget.used}`, true);
      }
      return;
    }

    await this.guardrail.markInputProcessed(inputHash);

    let rawOutput: string;
    try {
      rawOutput = await this.generator.generate(prompt);
    } catch (genErr) {
      this.logger.error(`Generation failed for ${contentKey}: ${(genErr as Error).message}`);
      const draft = await this.contentRepo.insertDraft({
        contentKey, sourceEventId: eventId, aggregateId, contentType,
        rawOutput: { prompt, error: (genErr as Error).message },
        tokenCount: estTokens, provider: 'generation_error',
      });
      if (draft) {
        await this.contentRepo.updateStatus(draft.id, 'rejected', null, (genErr as Error).message, true);
      }
      return;
    }

    const tokenCount = GuardrailService.estimateTokens(rawOutput) + estTokens;

    const dbRow = await this.contentRepo.insertDraft({
      contentKey, sourceEventId: eventId, aggregateId, contentType,
      rawOutput: { prompt, raw: rawOutput },
      tokenCount, provider: 'dummy',
    });

    if (!dbRow) {
      this.logger.log(`Duplicate event processed: ${eventId}`);
      return;
    }

    const validation = this.guardrail.validate(rawOutput);
    if (validation.ok) {
      await this.contentRepo.updateStatus(dbRow.id, 'verified', validation.content, null, false);
      await this.contentRepo.markVerified(dbRow.id);
      await this.contentRepo.updateStatus(dbRow.id, 'published', validation.content, null, false);
      this.logger.log(`Generated + published: ${contentKey} (${tokenCount} tokens)`);
    } else {
      const reason = validation.errors.join('; ');
      await this.contentRepo.updateStatus(dbRow.id, 'rejected', null, reason, true);
      this.logger.warn(`Guardrail rejected: ${contentKey} — ${reason}`);
    }
  }

  private buildProductPrompt(product: Record<string, unknown>): string {
    const name = String(product['name'] ?? '');
    const desc = String(product['description'] ?? '');
    const price = String(product['price'] ?? '');
    const currency = String(product['currency'] ?? 'KRW');
    return `상품 "${name}" (가격: ${price} ${currency})에 대한 마케팅 설명을 생성하세요.\n기존 설명: ${desc}\n응답은 반드시 JSON 형식으로 해주세요.`;
  }

  private buildReviewPrompt(review: { productId: number; avgRating: number; reviewCount: number }): string {
    return `상품 ID ${review.productId}의 리뷰 데이터 (평균 평점: ${review.avgRating}, 리뷰 수: ${review.reviewCount})를 기반으로\n마케팅 문구를 생성하세요. 응답은 반드시 JSON 형식으로 해주세요.`;
  }
}
