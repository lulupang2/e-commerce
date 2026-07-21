import type { RecommendResultItem } from '@shared/schemas';

type Props = { item: RecommendResultItem };

export function RecommendCard({ item }: Props) {
  const pct = Math.round(item.signals.combined * 100);

  return (
    <div className="card">
      <h3 className="text-base font-medium leading-snug">{item.name}</h3>
      {item.description && (
        <p className="text-sm text-muted font-light line-clamp-2">{item.description}</p>
      )}
      <div className="flex items-center justify-between mt-1">
        <span className="text-sm font-medium">
          {item.price.toLocaleString()} {item.currency}
        </span>
        <span className="pill pill-accent">{pct}%</span>
      </div>
      {item.reason && (
        <p className="text-xs text-muted font-light mt-1 pt-2 border-t border-gray-100">
          {item.reason}
        </p>
      )}
    </div>
  );
}
