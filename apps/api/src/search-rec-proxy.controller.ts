// 이 파일의 책임: search-rec HTTP 프록시 — 쿼리/바디·상태코드·본문을 그대로 전달, 장애 시 502
// 트레이드오프: 단순 패스스루는 검증/재시도를 추가하지 않아 가볍지만, circuit breaker 는 후속 과제
import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

const SEARCH_REC_URL = process.env['SEARCH_REC_URL'] ?? 'http://localhost:3001';

@Controller()
export class SearchRecProxyController {
  private async forward(
    path: string,
    query: Record<string, unknown>,
    res: Response,
    body?: unknown,
  ): Promise<void> {
    const qs = new URLSearchParams(
      Object.entries(query).map(([k, v]) => [k, String(v)]),
    ).toString();
    const url = `${SEARCH_REC_URL}${path}${qs ? `?${qs}` : ''}`;
    try {
      const upstream = await fetch(url, {
        method: body !== undefined ? 'POST' : 'GET',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
      const text = await upstream.text();
      res
        .status(upstream.status)
        .type(upstream.headers.get('content-type') ?? 'application/json')
        .send(text);
    } catch {
      res.status(502).json({ statusCode: 502, message: 'search-rec unavailable' });
    }
  }

  @Get('search')
  search(@Query() query: Record<string, unknown>, @Res() res: Response): Promise<void> {
    return this.forward('/search', query, res);
  }

  @Get('recommend/home')
  recommendHome(@Query() query: Record<string, unknown>, @Res() res: Response): Promise<void> {
    return this.forward('/recommend/home', query, res);
  }

  @Get('recommend/related')
  recommendRelated(@Query() query: Record<string, unknown>, @Res() res: Response): Promise<void> {
    return this.forward('/recommend/related', query, res);
  }

  @Post('recommend/invalidate-home')
  invalidateHome(@Body() body: unknown, @Res() res: Response): Promise<void> {
    return this.forward('/recommend/invalidate-home', {}, res, body);
  }
}
