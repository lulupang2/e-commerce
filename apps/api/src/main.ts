// API 게이트웨이 진입점 — search-rec 모듈을 포함한 e커머스 MSA 백엔드
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();

  const port = process.env['PORT'] ? Number(process.env['PORT']) : 3000;
  await app.listen(port);
  console.log(`API server running on http://localhost:${port}/api`);
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
