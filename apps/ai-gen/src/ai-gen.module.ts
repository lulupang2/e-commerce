// 이 파일의 책임: AiGenModule NestJS 동적 모듈 — Redis Stream consumer·provider·guardrail 조립
import { Module, DynamicModule, Provider } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { StreamConsumer } from './consumer/stream.consumer';
import { GenerationProvider } from './generation/generation.interface';
import { DummyGenerationProvider } from './generation/dummy.provider';
import { GuardrailService } from './guardrail/guardrail.service';
import { ContentRepository } from './content.repository';
import { AiGenService } from './ai-gen.service';

export interface AiGenModuleOptions {
  pgPool: Pool;
  redis: Redis;
  generationProvider?: GenerationProvider;
}

@Module({})
export class AiGenModule {
  static forRoot(options: AiGenModuleOptions): DynamicModule {
    const generationProvider: Provider = {
      provide: GenerationProvider,
      useValue: options.generationProvider ?? new DummyGenerationProvider(),
    };

    const providers: Provider[] = [
      {
        provide: ContentRepository,
        useFactory: (pgPool: Pool) => new ContentRepository(pgPool),
        inject: ['PG_POOL'],
      },
      {
        provide: GuardrailService,
        useFactory: (redis: Redis) => new GuardrailService(redis),
        inject: ['REDIS_CLIENT'],
      },
      generationProvider,
      {
        provide: StreamConsumer,
        useFactory: (
          redis: Redis,
          generator: GenerationProvider,
          guardrail: GuardrailService,
          contentRepo: ContentRepository,
        ) => new StreamConsumer(redis, generator, guardrail, contentRepo),
        inject: ['REDIS_CLIENT', GenerationProvider, GuardrailService, ContentRepository],
      },
      {
        provide: AiGenService,
        useFactory: (consumer: StreamConsumer) => new AiGenService(consumer),
        inject: [StreamConsumer],
      },
      { provide: 'PG_POOL', useValue: options.pgPool },
      { provide: 'REDIS_CLIENT', useValue: options.redis },
    ];

    return {
      module: AiGenModule,
      providers: [...providers],
      exports: [AiGenService, StreamConsumer, GenerationProvider, GuardrailService, ContentRepository],
    };
  }
}
