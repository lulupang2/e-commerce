// 이 파일의 책임: 결정론적 더미 임베딩 — SHA-256 해시 → 정규화 벡터 (테스트/검증용)
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EmbeddingProvider } from './embedding.interface';

@Injectable()
export class DummyEmbeddingProvider extends EmbeddingProvider {
  constructor(private readonly dim: number) {
    super();
  }

  async embed(text: string): Promise<number[]> {
    const hash = createHash('sha256').update(text).digest();
    const vec: number[] = [];
    for (let i = 0; i < this.dim; i++) {
      vec.push(hash[i % hash.length] / 128 - 1);
    }
    // L2 정규화: ||v|| = 1
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}
