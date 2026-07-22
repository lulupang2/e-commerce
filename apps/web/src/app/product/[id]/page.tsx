import { getRecommendRelated } from '@/lib/api';
import { RecommendCard } from '@/components/RecommendCard';
import { GeneratedDescription, NoAIDescription } from '@/components/GeneratedDescription';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function fetchPublishedDescription(productId: string): Promise<{ title?: string; body: string } | null> {
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) return null;

  // dynamic import — pg는 서버에서만 import 가능
  const { Pool } = await import('pg');
  const pgPool = new Pool({ connectionString: dbUrl });

  try {
    const sql = /* sql */ `
      SELECT validated
      FROM generated_contents
      WHERE aggregate_id = $1
        AND content_type = 'description'
        AND status = 'published'
        AND verified_at IS NOT NULL
        AND needs_human_review = FALSE
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const result = await pgPool.query<{ validated: Record<string, unknown> }>(sql, [productId]);
    await pgPool.end();
    const validated = result.rows[0]?.validated;
    if (validated && typeof validated['body'] === 'string') {
      return {
        title: typeof validated['title'] === 'string' ? validated['title'] : undefined,
        body: validated['body'] as string,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export default async function ProductPage({ params }: { params: { id: string } }) {
  const productId = Number(params.id);

  let relatedItems: React.ReactNode[] = [];
  let aiDesc: { title?: string; body: string } | null = null;
  let relatedError = false;

  try {
    const data = await getRecommendRelated(productId, 6);
    relatedItems = data.items.map((item) => <RecommendCard key={item.id} item={item} />);
  } catch {
    relatedError = true;
  }

  try {
    aiDesc = await fetchPublishedDescription(params.id);
  } catch {
    aiDesc = null;
  }

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
        <section>
          <h2 className="text-lg font-medium mb-4">상품 정보</h2>
          <div className="card">
            <p className="font-light text-muted">상품 ID: {productId}</p>
            <p className="font-light text-muted text-sm mt-1">
              상세 정보는 search-rec API 를 통해 조회됩니다.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-medium mb-4">AI 생성 설명</h2>
          <div className="card min-h-[120px]">
            {aiDesc ? (
              <GeneratedDescription body={aiDesc.body} title={aiDesc.title} />
            ) : (
              <NoAIDescription />
            )}
          </div>
        </section>
      </div>

      <section>
        <h2 className="text-xl font-medium mb-6">관련 상품</h2>
        {relatedError ? (
          <p className="text-center py-12 font-light text-muted">관련 상품을 불러올 수 없습니다.</p>
        ) : relatedItems.length === 0 ? (
          <p className="text-center py-12 font-light text-muted">관련 상품이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {relatedItems}
          </div>
        )}
      </section>
    </div>
  );
}
