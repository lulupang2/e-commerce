// 이 파일의 책임: GenerationProvider 추상화 — ai-gen 모듈은 실제 LLM 구현을 모르고 인터페이스만 의존
export abstract class GenerationProvider {
  abstract generate(prompt: string): Promise<string>;
}

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
}
