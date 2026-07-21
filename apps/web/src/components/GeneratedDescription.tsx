// 가드레일: rejected·draft 상태의 description 은 절대 클라이언트에 노출되지 않음
// DB 조회 시 WHERE status='published' AND verified_at IS NOT NULL 로 필터링

interface Props {
  body: string;
  title?: string;
}

export function GeneratedDescription({ body, title }: Props) {
  return (
    <div>
      <span className="pill pill-terracotta mb-4 inline-block">AI 생성</span>
      {title && <h3 className="text-lg font-medium mt-3 mb-2">{title}</h3>}
      <p className="text-base font-light text-gray-700 leading-relaxed whitespace-pre-wrap">
        {body}
      </p>
    </div>
  );
}

export function NoAIDescription() {
  return (
    <p className="font-light text-muted text-sm">아직 AI 생성 설명이 준비되지 않았습니다.</p>
  );
}
