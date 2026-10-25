// テスト共通：fake-indexeddb で毎回まっさらな DB を開く
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from '../js/db.js';

export function freshDB(options = {}) {
  return openDB({ indexedDB: new IDBFactory(), ...options });
}

// サンプルデータはすべて架空の企業・人物
export const SAMPLE_COMPANY = Object.freeze({
  name: '株式会社サンプル商事',
  industry: 'ITサービス',
  url: 'https://example.com',
  location: '東京都',
  employees: '120',
  founded: '2010',
  listing: '非上場',
  salaryMin: '500',
  salaryMax: '800',
  interestLevel: '4',
  tags: 'SaaS, リモート',
});
