// 이 파일의 책임: 게이트웨이 health — search-rec 서비스 /health 를 실제 호출해 의존성 전파 확인
import { Controller, Get } from '@nestjs/common';

const SEARCH_REC_URL = process.env['SEARCH_REC_URL'] ?? 'http://localhost:3001';

@Controller()
export class HealthController {
  @Get('health')
  async health(): Promise<Record<string, unknown>> {
    let searchRec = 'down';
    try {
      const r = await fetch(`${SEARCH_REC_URL}/health`, { signal: AbortSignal.timeout(3000) });
      searchRec = r.ok ? 'up' : 'down';
    } catch {
      searchRec = 'down';
    }
    return {
      status: searchRec === 'up' ? 'ok' : 'degraded',
      deps: { searchRec },
    };
  }
}
