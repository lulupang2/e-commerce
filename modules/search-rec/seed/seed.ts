// 이 스크립트의 책임: 검증용 시드 데이터 — 상품 10건 + DummyEmbeddingProvider 임베딩 삽입
//
// 실행: cd modules/search-rec && npx tsx seed/seed.ts
// 사전 조건: Postgres running, products 테이블 존재, migration 적용 완료
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PGVECTOR_DIM } from '@shared/schemas';
import { DummyEmbeddingProvider } from '../src/embedding/dummy.provider';

const PG_CONNECTION = process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/portfolio';

interface SeedProduct {
  sku: string;
  name: string;
  description: string;
  category: string;
  price: number;
}

const PRODUCTS: SeedProduct[] = [
  { sku: 'PHONE-001', name: '갤럭시 S25 울트라', description: '삼성 플래그십 스마트폰 AI 칩 200MP 칩', category: '스마트폰', price: 1698400 },
  { sku: 'PHONE-002', name: '아이폰 16 프로', description: '애플 A18 Pro 칩 티타늄 디자인', category: '스마트폰', price: 1550000 },
  { sku: 'AUDIO-001', name: '무선 블루투스 이어폰', description: '노이즈캔슬링 지원 고음질 이어폰 30시간 배터리', category: '오디오', price: 129000 },
  { sku: 'AUDIO-002', name: '스튜디오 모니터 헤드폰', description: '프로 레코딩 믹싱 마스터링 레퍼런스 사운드', category: '오디오', price: 249000 },
  { sku: 'LAPTOP-001', name: '맥북 프로 16인치 M4', description: 'Apple M4 Pro 36GB RAM 1TB SSD 프로 워크스테이션', category: '노트북', price: 3690000 },
  { sku: 'LAPTOP-002', name: 'LG 그램 17인치', description: '초경량 노트북 1.35kg 대화면 17인치 WQXGA 배터리 20시간', category: '노트북', price: 1890000 },
  { sku: 'TABLET-001', name: '아이패드 프로 12.9 M4', description: 'M4 칩 XDR 디스플레이 애플 펜슬 프로 크리에이터 태블릿', category: '태블릿', price: 1720000 },
  { sku: 'WATCH-001', name: '갤럭시 워치 7', description: '삼성 바이오액티브 센서 수면 혈압 심박수 피트니스 스마트워치', category: '스마트워치', price: 399000 },
  { sku: 'WATCH-002', name: '애플 워치 울트라 2', description: '티타늄 케이스 49mm 사파이어 글래스 다이빙 러닝 아웃도어', category: '스마트워치', price: 1149000 },
  { sku: 'ACCESSORY-001', name: 'USB-C 허브 7in1', description: '맥북 아이패드 호환 HDMI 4K USB3.0 SD카드 리더', category: '액세서리', price: 49000 },
];

async function seed(): Promise<void> {
  const pool = new Pool({ connectionString: PG_CONNECTION });
  const embedder = new DummyEmbeddingProvider(PGVECTOR_DIM);

  let inserted = 0;
  for (const p of PRODUCTS) {
    const embedding = await embedder.embed(`${p.name} ${p.description}`);
    const metadata = JSON.stringify({ category: p.category });
    const vectorStr = '[' + embedding.map(String).join(',') + ']';
    const sql = /* sql */ `
      INSERT INTO products (uuid, sku, name, description, price, currency, stock, status, metadata, embedding)
      VALUES ($1, $2, $3, $4, $5, 'KRW', 100, 'ACTIVE', $6::jsonb, $7::vector)
      ON CONFLICT (sku) DO UPDATE SET
        name        = EXCLUDED.name,
        description = EXCLUDED.description,
        price       = EXCLUDED.price,
        metadata    = EXCLUDED.metadata,
        embedding   = EXCLUDED.embedding,
        updated_at  = now()
    `;
    await pool.query(sql, [randomUUID(), p.sku, p.name, p.description, p.price, metadata, vectorStr]);
    inserted += 1;
  }

  // product_views 시드 (인기도 신호)
  const { rows: productRows } = await pool.query<{ id: number }>('SELECT id FROM products WHERE status = $1', ['ACTIVE']);
  for (const row of productRows) {
    const viewCount = Math.floor(Math.random() * 500) + 50;
    const saleCount = Math.floor(Math.random() * 100) + 5;
    await pool.query(
      `INSERT INTO product_views (product_id, view_count, sale_count) VALUES ($1, $2, $3)
       ON CONFLICT (product_id) DO UPDATE SET view_count = EXCLUDED.view_count, sale_count = EXCLUDED.sale_count`,
      [row.id, viewCount, saleCount],
    );
  }

  await pool.end();
  console.log(`Seeded ${inserted} products + ${productRows.length} view records`);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
