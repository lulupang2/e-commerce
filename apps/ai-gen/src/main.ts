// 이 파일의 책임: ai-gen 독립 서비스 부트스트랩 — Stream consumer 구동 + PORT(:3002) /health
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const port = process.env['PORT'] ? Number(process.env['PORT']) : 3002;
  await app.listen(port);
  console.log(`ai-gen service running on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
