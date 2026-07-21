'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef } from 'react';

export function SearchBar() {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      clearTimeout(timerRef.current);
      const q = e.target.value;
      if (!q.trim()) return;
      timerRef.current = setTimeout(() => {
        router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }, 300);
    },
    [router],
  );

  return (
    <div className="mb-6">
      <input
        type="search"
        className="w-full py-3.5 px-5 text-base font-light border border-gray-200 rounded-card outline-none bg-white focus:border-accent-start focus:ring-[3px] focus:ring-accent-start/15 transition-shadow"
        placeholder="검색어를 입력하세요..."
        onChange={onChange}
      />
    </div>
  );
}
