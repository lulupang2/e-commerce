import { searchProducts } from '@/lib/api';
import { SearchBar } from '@/components/SearchBar';
import { RecommendCard } from '@/components/RecommendCard';
import { FallbackBadge } from '@/components/FallbackBadge';

export const dynamic = 'force-dynamic';

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const query = searchParams.q ?? '';
  let items: React.ReactNode[] = [];
  let source = '';

  if (query) {
    try {
      const data = await searchProducts(query);
      source = data.source;
      items = data.items.map((item) => (
        <RecommendCard
          key={item.id ?? 0}
          item={{
            id: item.id ?? 0,
            uuid: item.uuid,
            sku: item.sku,
            name: item.name,
            description: item.description ?? undefined,
            price: item.price,
            currency: item.currency,
            stock: item.stock,
            status: item.status,
            metadata: item.metadata,
            reason: '',
            signals: {
              semantic: item.similarity,
              popularity: 0,
              affinity: 0,
              combined: item.similarity,
            },
          }}
        />
      ));
    } catch {
      items = [<p key="err" className="text-center py-12 font-light text-muted col-span-full">검색 결과를 불러올 수 없습니다.</p>];
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-medium mb-6">상품 검색</h1>
      <SearchBar />
      {source === 'trgm_fallback' && (
        <div className="mb-4">
          <FallbackBadge />
        </div>
      )}
      {query && items.length === 0 && (
        <p className="text-center py-12 font-light text-muted">검색 결과가 없습니다</p>
      )}
      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items}
        </div>
      )}
    </div>
  );
}
