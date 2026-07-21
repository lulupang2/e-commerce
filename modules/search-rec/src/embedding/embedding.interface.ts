// 이 파일의 책임: 임베딩 프로바이더 추상화 — 검색 모듈은 생성 로직을 모르고 인터페이스만 의존
export abstract class EmbeddingProvider {
  /** 텍스트 → 정규화된 임베딩 벡터 (차원은 프로바이더가 결정) */
  abstract embed(text: string): Promise<number[]>;
}
