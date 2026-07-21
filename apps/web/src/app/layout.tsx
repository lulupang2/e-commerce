import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'e커머스 MSA — AI-native',
  description: '의미론 검색 · 이유 있는 추천 · AI 생성 설명',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        <header className="bg-white border-b border-gray-100">
          <div className="max-w-6xl mx-auto flex items-center justify-between py-4 px-6">
            <a href="/" className="text-lg font-medium no-underline text-inherit tracking-tight">
              e커머스 MSA
            </a>
            <nav>
              <a href="/search" className="font-normal text-muted no-underline hover:text-accent-start transition-colors">
                검색
              </a>
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8 md:py-12">
          {children}
        </main>
      </body>
    </html>
  );
}
