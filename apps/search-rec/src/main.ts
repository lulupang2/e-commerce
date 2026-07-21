// 이 파일의 책임: search-rec 독립 서비스 부트스트랩 — PORT(:3001) + /health
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  const port = process.env['PORT'] ? Number(process.env['PORT']) : 3001;
  await app.listen(port);
  console.log(`search-rec service running on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
