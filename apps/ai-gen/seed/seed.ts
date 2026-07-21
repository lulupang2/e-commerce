// 이 파일의 책임: product.created 이벤트 수동 발행 → consumer 소비 검증
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import {
  BaseEventSchema,
  ProductCreatedEventSchema,
  EVENT_NAMES,
} from '@shared/schemas';

const STREAM_KEY = 'ai:events';

async function main(): Promise<void> {
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://:change-me@localhost:6379';
  const redis = new Redis(redisUrl);

  const eventId = process.env['EVENT_ID'] ?? crypto.randomUUID();
  const now = new Date().toISOString();

  const hash = createHash('sha256').update('test-product-seed').digest();
  const embedding: number[] = [];
  for (let i = 0; i < 1536; i++) {
    embedding.push(hash[i % hash.length] / 128 - 1);
  }

  const event = ProductCreatedEventSchema.parse({
    schemaVersion: '1.0.0',
    eventId,
    occurredAt: now,
    aggregateId: '99999',
    eventName: EVENT_NAMES.PRODUCT_CREATED,
    payload: {
      id: 99999,
      uuid: crypto.randomUUID(),
      sku: `TEST-SEED-${eventId.slice(0, 8)}`,
      name: '시드 테스트 상품 (AI 생성 검증)',
      description: '이 상품은 Redis Stream → consumer → 생성 → 검증 파이프라인을 테스트합니다.',
      price: 10000,
      currency: 'KRW',
      stock: 100,
      status: 'ACTIVE',
      embedding,
      metadata: { category: '테스트', brand: 'SeedCo' },
    },
  });

  const payload = JSON.stringify(event);

  // Dedup guard: prevent re-publish
  const dedupKey = `ai:dedup:stream:${eventId}`;
  const isNew = await redis.setnx(dedupKey, '1');
  if (!isNew) {
    console.log(`Event ${eventId} already exists, skipping.`);
    await redis.quit();
    return;
  }
  await redis.expire(dedupKey, 86400);

  const streamId = await redis.xadd(
    STREAM_KEY,
    '*',
    'eventName', event.eventName,
    'eventId', event.eventId,
    'schemaVersion', event.schemaVersion,
    'occurredAt', event.occurredAt,
    'aggregateId', event.aggregateId,
    'payload', payload,
  );

  console.log(`Published event: id=${eventId}, streamId=${streamId}`);
  console.log(`  Name: ${event.payload.name}`);
  console.log(`  Watch logs: docker logs -f <api-container>`);
  console.log(`  Check DB:  SELECT * FROM generated_contents WHERE source_event_id = '${eventId}'`);

  await redis.quit();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
