// 이 파일의 책임: 외부 LLM API 호출 (OpenAI 호환) — env 기반 실제 프로바이더
import { Injectable, Logger } from '@nestjs/common';
import { GenerationProvider } from './generation.interface';

@Injectable()
export class HttpGenerationProvider extends GenerationProvider {
  private readonly logger = new Logger(HttpGenerationProvider.name);

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string = 'gpt-4o-mini',
    private readonly maxTokens: number = 2000,
    private readonly temperature: number = 0.7,
  ) {
    super();
  }

  async generate(prompt: string): Promise<string> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: '당신은 e커머스 상품 콘텐츠 생성 전문가입니다. 한국어로 응답하며, JSON 형식만 출력합니다.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      response_format: { type: 'json_object' },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`LLM API ${res.status}: ${text.slice(0, 300)}`);
      throw new Error(`Generation API ${res.status}: ${text.slice(0, 200)}`);
    }

    const json: { choices: { message: { content: string } }[] } = await res.json();
    const content = json.choices[0]?.message?.content ?? '';
    return content;
  }
}
