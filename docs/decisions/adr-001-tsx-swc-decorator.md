# ADR-001: tsx + SWC 트랜스파일 (esbuild 한계 대응)

**날짜**: 2026-07-22
**상태**: accepted

## 배경

`tsx`는 기본 엔진으로 esbuild를 사용하지만, esbuild는 다음을 지원하지 않는다:

1. `experimentalDecorators` — NestJS 데코레이터 문법 파싱 실패
2. `emitDecoratorMetadata` — NestJS DI가 생성자 파라미터 타입을 추론 불가

## 결정

1. `@swc/core`를 디펜던시로 추가 (tsx가 자동 감지하여 SWC로 전환)
2. `.swcrc` 설정 — `legacyDecorator: true`, `decoratorMetadata: true`
3. 컨트롤러 생성자에 `@Inject()` 명시 (SWC의 `emitDecoratorMetadata` 만으로는 NestJS DI가 일부 케이스에서 실패)

## 대안

- `ts-node` — ESM/CJS 충돌로 기각
- `tsc` 사전 빌드 — esbuild/SWC 대비 개발 속도 느림, `moduleResolution: bundler` 시 `.js` 확장자 이슈
- esbuild 전용 — `emitDecoratorMetadata` 미지원으로 NestJS DI 불가

## 결과

- 서버 기동: `pnpm exec tsx apps/api/src/main.ts` (3000번)
- tsx가 SWC를 사용하여 decorator metadata 정상 방출
- 신규 컨트롤러 작성 시 `@Inject()` 패턴 필수
