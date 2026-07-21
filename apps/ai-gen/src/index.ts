// 이 파일의 책임: @ai/gen 배럴 — AiGenModule 및 모든 공개 프로바이더를 re-export
export { AiGenModule, type AiGenModuleOptions } from './ai-gen.module';
export { AiGenService } from './ai-gen.service';
export { GenerationProvider } from './generation/generation.interface';
export { DummyGenerationProvider } from './generation/dummy.provider';
export { HttpGenerationProvider } from './generation/http.provider';
export { GuardrailService } from './guardrail/guardrail.service';
export { ContentRepository } from './content.repository';
export { StreamConsumer } from './consumer/stream.consumer';

import { GenerationProvider } from './generation/generation.interface';
import { DummyGenerationProvider } from './generation/dummy.provider';
import { HttpGenerationProvider } from './generation/http.provider';

export function createDummyGenerationProvider(): GenerationProvider {
  return new DummyGenerationProvider();
}

export function createHttpGenerationProvider(
  baseUrl: string = process.env['GEN_BASE_URL'] ?? '',
  apiKey: string = process.env['GEN_API_KEY'] ?? '',
  model: string = process.env['GEN_MODEL'] ?? 'gpt-4o-mini',
): GenerationProvider {
  return new HttpGenerationProvider(baseUrl, apiKey, model);
}
