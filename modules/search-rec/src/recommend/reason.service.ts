// 이 서비스의 책임: 규칙 기반 reason 생성 (결정론) — 기여 신호에서 템플릿 문구 매핑
// LLM 기반 추론 강화: LLmReasonProvider 인터페이스 (기본 비활성)
//   → 프로덕션에서는 ai-gateway 마이크로서비스로 위임, POST /recommend/:id/enrich 로 비동기 보강
import { Injectable } from '@nestjs/common';
import { RecommendSignals } from '@shared/schemas';
import { getReasonTemplate } from './reason-templates';

type SignalKey = 'semantic' | 'popularity' | 'affinity';

export interface LLmReasonRequest {
  productName: string;
  signals: RecommendSignals;
  category: string;
}

/** LLM 기반 reason 생성 인터페이스 (기본 비활성, ai-gateway 위임용) */
export interface LLmReasonProvider {
  enrich(reason: LLmReasonRequest): Promise<string>;
}

@Injectable()
export class ReasonService {
  /**
   * 지배적 신호 1~2개로 reason 코드 결정 → 템플릿 적용
   * (동일 입력 → 동일 출력, 결정론적)
   */
  generate(
    productName: string,
    category: string,
    signals: RecommendSignals,
    isColdStart: boolean,
    seedProductName?: string,
  ): string {
    // 콜드스타트 분기
    if (isColdStart) {
      if (seedProductName) {
        return getReasonTemplate('COLD_START_PRODUCT')(seedProductName);
      }
      return getReasonTemplate('COLD_START_USER')();
    }

    const { semantic, popularity, affinity } = signals;

    // 지배적 신호 1·2 순위 결정
    const ranked = (
      [
        { key: 'semantic' as SignalKey, val: semantic },
        { key: 'popularity' as SignalKey, val: popularity },
        { key: 'affinity' as SignalKey, val: affinity },
      ] as const
    )
      .filter((s) => s.val > 0)
      .sort((a, b) => b.val - a.val);

    const primary = ranked[0];
    const secondary = ranked[1];

    // semantic + popularity 혼합 (두 신호 모두 0보다 크면)
    if (
      primary?.key === 'semantic' &&
      secondary?.key === 'popularity' &&
      secondary.val > 0.1
    ) {
      return getReasonTemplate('SEMANTIC_POPULAR_MIX')(productName, category);
    }

    switch (primary?.key) {
      case 'semantic':
        return getReasonTemplate('SEMANTIC_SIMILAR')(productName);
      case 'popularity':
        return getReasonTemplate('POPULAR_TOP')(
          category,
          popularity > 0.3 ? '10' : '30',
        );
      case 'affinity':
        return getReasonTemplate('AFFINITY_CATEGORY')(category);
      default:
        return getReasonTemplate('POPULAR_TOP')(category, '50');
    }
  }

  /** 지배 신호를 인라인으로 판정 (외부 호출용) */
  getDominantSignal(signals: RecommendSignals): SignalKey {
    const { semantic, popularity, affinity } = signals;
    if (semantic >= popularity && semantic >= affinity) return 'semantic';
    if (popularity >= affinity) return 'popularity';
    return 'affinity';
  }
}
