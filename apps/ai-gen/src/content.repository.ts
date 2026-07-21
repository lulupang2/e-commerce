// 이 파일의 책임: generated_content 테이블 CRUD — source_event_id UNIQUE 멱등 보장
import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type { GeneratedContent, GeneratedContentDb } from '@shared/schemas';

export interface ContentRow {
  id: number;
  contentKey: string;
  sourceEventId: string;
  aggregateId: string;
  contentType: string;
  rawOutput: Record<string, unknown>;
  validated: GeneratedContent | null;
  status: 'draft' | 'verified' | 'published' | 'rejected';
  rejectionReason: string | null;
  needsHumanReview: boolean;
  tokenCount: number;
  provider: string;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
}

@Injectable()
export class ContentRepository {
  private readonly logger = new Logger(ContentRepository.name);

  constructor(private readonly pool: Pool) {}

  private mapRow(row: Record<string, unknown>): ContentRow {
    return {
      id: Number(row['id']),
      contentKey: String(row['content_key']),
      sourceEventId: String(row['source_event_id']),
      aggregateId: String(row['aggregate_id']),
      contentType: String(row['content_type']),
      rawOutput: row['raw_output'] as Record<string, unknown>,
      validated: row['validated'] as GeneratedContent | null,
      status: row['status'] as ContentRow['status'],
      rejectionReason: row['rejection_reason'] != null ? String(row['rejection_reason']) : null,
      needsHumanReview: Boolean(row['needs_human_review']),
      tokenCount: Number(row['token_count']),
      provider: String(row['provider']),
      createdAt: row['created_at'] instanceof Date
        ? row['created_at'].toISOString()
        : String(row['created_at'] ?? ''),
      updatedAt: row['updated_at'] instanceof Date
        ? row['updated_at'].toISOString()
        : String(row['updated_at'] ?? ''),
      verifiedAt: row['verified_at'] instanceof Date
        ? row['verified_at'].toISOString()
        : (row['verified_at'] != null ? String(row['verified_at']) : null),
    };
  }

  async insertDraft(row: {
    contentKey: string;
    sourceEventId: string;
    aggregateId: string;
    contentType: string;
    rawOutput: Record<string, unknown>;
    tokenCount: number;
    provider: string;
  }): Promise<ContentRow | null> {
    const sql = /* sql */ `
      INSERT INTO generated_contents
        (content_key, source_event_id, aggregate_id, content_type, raw_output, status, needs_human_review, token_count, provider)
      VALUES ($1, $2, $3, $4, $5::jsonb, 'draft', FALSE, $6, $7)
      ON CONFLICT (source_event_id, content_type) DO NOTHING
      RETURNING id, content_key, source_event_id, aggregate_id, content_type,
                raw_output, validated, status, rejection_reason,
                needs_human_review, token_count, provider,
                created_at, updated_at, verified_at
    `;
    const result = await this.pool.query(sql, [
      row.contentKey,
      row.sourceEventId,
      row.aggregateId,
      row.contentType,
      JSON.stringify(row.rawOutput),
      row.tokenCount,
      row.provider,
    ]);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  async markVerified(id: number): Promise<void> {
    const sql = /* sql */ `
      UPDATE generated_contents SET verified_at = NOW(), updated_at = NOW() WHERE id = $1
    `;
    await this.pool.query(sql, [id]);
  }

  async updateStatus(
    id: number,
    status: ContentRow['status'],
    validated: GeneratedContent | null,
    rejectionReason: string | null,
    needsHumanReview: boolean,
  ): Promise<void> {
    const sql = /* sql */ `
      UPDATE generated_contents
      SET status = $2, validated = $3::jsonb, rejection_reason = $4,
          needs_human_review = $5, updated_at = NOW()
      WHERE id = $1
    `;
    await this.pool.query(sql, [
      id,
      status,
      validated ? JSON.stringify(validated) : null,
      rejectionReason,
      needsHumanReview,
    ]);
  }

  async findPublishedByAggregateId(aggregateId: string): Promise<ContentRow[]> {
    const sql = /* sql */ `
      SELECT id, content_key, source_event_id, aggregate_id, content_type,
             raw_output, validated, status, rejection_reason,
             needs_human_review, token_count, provider,
             created_at, updated_at, verified_at
      FROM generated_contents
      WHERE aggregate_id = $1 AND status = 'published'
      ORDER BY created_at DESC
    `;
    const result = await this.pool.query(sql, [aggregateId]);
    return result.rows.map((r) => this.mapRow(r));
  }

  async findBySourceEventId(eventId: string): Promise<ContentRow[]> {
    const sql = /* sql */ `
      SELECT id, content_key, source_event_id, aggregate_id, content_type,
             raw_output, validated, status, rejection_reason,
             needs_human_review, token_count, provider,
             created_at, updated_at, verified_at
      FROM generated_contents
      WHERE source_event_id = $1
    `;
    const result = await this.pool.query(sql, [eventId]);
    return result.rows.map((r) => this.mapRow(r));
  }
}
