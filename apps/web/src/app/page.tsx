import { getRecommendHome } from '@/lib/api';
import { RecommendCard } from '@/components/RecommendCard';
import { ColdStartBadge } from '@/components/ColdStartBadge';

export default async function HomePage() {
  const userId = '550e8400-e29b-41d4-a716-446655440000';
  let items: React.ReactNode[] = [];
  let source = '';

  try {
    const data = await getRecommendHome(userId, 12);
    source = data.source;
    items = data.items.map((item) => <RecommendCard key={item.id} item={item} />);
  } catch (err) {
    return (
      <div className="text-center py-12 font-light text-muted">
        추천을 불러올 수 없습니다. search-rec 서비스가 실행 중인지 확인하세요.
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-medium mb-6 flex items-center gap-2">
        오늘의 추천
        {source === 'cold_start_user' && <ColdStartBadge />}
      </h1>
      {items.length === 0 ? (
        <p className="text-center py-12 font-light text-muted">추천 가능한 상품이 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items}
        </div>
      )}
    </div>
  );
}
