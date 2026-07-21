// 이 파일의 책임: 결정론적 더미 생성 — 동일 입력 → 동일 출력 (테스트/검증용)
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { GenerationProvider } from './generation.interface';

@Injectable()
export class DummyGenerationProvider extends GenerationProvider {
  async generate(prompt: string): Promise<string> {
    const hash = createHash('sha256').update(prompt).digest('hex');
    const canonical = prompt.slice(0, 20).replace(/[^가-힣a-zA-Z0-9]/g, '_');

    return JSON.stringify({
      contentType: 'description',
      title: `AI 생성: ${canonical}`,
      body: `[${hash.slice(0, 8)}] "${canonical}"에 대한 생성물입니다. 상품의 주요 특징, 장점, 타겟 사용자를 상세히 설명합니다. 품질 보증과 A/S 정보도 포함되어 있습니다.`,
      keywords: ['테스트', '생성', '더미'],
      bannedWordsChecked: true,
      language: 'ko',
      confidence: 0.85,
    });
  }
}
