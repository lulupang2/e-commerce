// 이 파일의 책임: AiGenService — NestJS OnModuleInit 으로 StreamConsumer 시작
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { StreamConsumer } from './consumer/stream.consumer';

@Injectable()
export class AiGenService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiGenService.name);

  constructor(private readonly consumer: StreamConsumer) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('Starting AI generation stream consumer...');
    await this.consumer.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.onModuleDestroy();
  }
}
