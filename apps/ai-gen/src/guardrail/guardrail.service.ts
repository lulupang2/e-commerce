// 이 파일의 책임: zod 가드레일 — 생성물 검증·토큰예산·금지어 → status 결정
import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import {
  GeneratedContentSchema,
  BANNED_WORDS,
  type GeneratedContent,
} from '@shared/schemas';

const DAILY_TOKEN_LIMIT = 500_000;
const DEDUP_TTL_SECONDS = 3600;

@Injectable()
export class GuardrailService {
  private readonly logger = new Logger(GuardrailService.name);

  constructor(private readonly redis: Redis) {}

  async checkBudget(tenant: string, tokenCount: number): Promise<{ ok: boolean; used: number }> {
    const today = new Date().toISOString().slice(0, 7).replace('-', '');
    const key = `ai:budget:${tenant}:${today}`;
    const ttl = 25 * 60 * 60; // 25h for midnight rollover safety
    const used = await this.redis.incrby(key, tokenCount);
    if (used === tokenCount) {
      await this.redis.expire(key, ttl);
    }
    if (used > DAILY_TOKEN_LIMIT) {
      this.logger.warn(`Token budget exceeded: tenant=${tenant}, used=${used}/${DAILY_TOKEN_LIMIT}`);
      return { ok: false, used };
    }
    return { ok: true, used };
  }

  async isDuplicateInput(inputHash: string): Promise<boolean> {
    const key = `ai:dedup:sha256:${inputHash}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  async markInputProcessed(inputHash: string): Promise<void> {
    const key = `ai:dedup:sha256:${inputHash}`;
    await this.redis.set(key, '1', 'EX', DEDUP_TTL_SECONDS);
  }

  validate(raw: string): { ok: true; content: GeneratedContent } | { ok: false; errors: string[] } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, errors: ['Invalid JSON output from provider'] };
    }

    const bannedWords = BANNED_WORDS.slice();
    const bodyText = typeof (parsed as Record<string, unknown>)['body'] === 'string'
      ? (parsed as Record<string, unknown>)['body'] as string
      : '';
    if (bannedWords.some((w) => bodyText.includes(w))) {
      return { ok: false, errors: ['Banned word detected in body'] };
    }

    const result = GeneratedContentSchema.safeParse(parsed);
    if (!result.success) {
      const messages = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return { ok: false, errors: messages };
    }

    return { ok: true, content: result.data };
  }

  static estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }
}
