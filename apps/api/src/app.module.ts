// 이 파일의 책임: API 게이트웨이 루트 모듈 — search-rec 직접 import 없이 HTTP 프록시 (BFF)
// 모듈 경계: apps/api 는 @shared/schemas 외 도메인 모듈 import 0 — 통신은 HTTP(동기)/이벤트(비동기)만
import { Module } from '@nestjs/common';
import { SearchRecProxyController } from './search-rec-proxy.controller';
import { HealthController } from './health.controller';

@Module({
  controllers: [SearchRecProxyController, HealthController],
})
export class AppModule {}
