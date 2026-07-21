// 이 파일의 책임: 외부 임베딩 API 호출 (OpenAI 호환) — baseUrl/apiKey env 주입
import { Injectable } from '@nestjs/common';
import { EmbeddingProvider } from './embedding.interface';

@Injectable()
export class HttpEmbeddingProvider extends EmbeddingProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string = 'text-embedding-3-small',
  ) {
    super();
  }

  async embed(text: string): Promise<number[]> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/embeddings`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: text, model: this.model }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Embedding API ${res.status}: ${body.slice(0, 200)}`);
    }

    const json: { data: { embedding: number[] }[] } = await res.json();
    return json.data[0]?.embedding ?? [];
  }
}
