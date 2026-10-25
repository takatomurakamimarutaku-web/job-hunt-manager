// 検索・正規化（純粋関数のみ。DOM・IndexedDBに依存しない）

/** ひらがな（ぁ〜ゖ）をカタカナに変換する */
export function hiraganaToKatakana(text) {
  return String(text).replace(/[ぁ-ゖ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60)
  );
}

/**
 * 検索用の正規化キーを作る。
 * NFKC正規化（全角英数→半角、半角カナ→全角）→ 小文字化 → ひらがな→カタカナ → 空白の整理
 */
export function normalize(text) {
  if (text === null || text === undefined) return '';
  let s = String(text).normalize('NFKC').toLowerCase();
  s = hiraganaToKatakana(s);
  return s.replace(/\s+/g, ' ').trim();
}

/** 正規化済みキーに検索語が含まれるか。空白区切りはAND条件 */
export function matches(key, query) {
  const words = normalize(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const k = normalize(key);
  return words.every((w) => k.includes(w));
}

// 重複判定では法人格の表記ゆれを無視する
const CORPORATE_FORMS = [
  '株式会社', '有限会社', '合同会社', '合資会社', '合名会社',
  '一般社団法人', '一般財団法人', '公益社団法人', '公益財団法人',
  '(株)', '(有)', '(同)', '㈱', '㈲',
];
const CORPORATE_FORM_KEYS = CORPORATE_FORMS.map(normalize);

/** 企業名から法人格を除いた比較用キー */
export function companyCoreKey(name) {
  let k = normalize(name);
  for (const form of CORPORATE_FORM_KEYS) {
    k = k.split(form).join('');
  }
  return k.replace(/\s+/g, '');
}

/**
 * 入力中の企業名に似た既存企業を返す（重複登録の防止用）。
 * 完全一致 → 前方一致 → 部分一致 の順。法人格の違いは無視する。
 * @returns {Array<{company: object, match: 'exact'|'prefix'|'partial'}>}
 */
export function findSimilarCompanies(companies, name, limit = 5) {
  const q = companyCoreKey(name);
  if (!q) return [];
  const rank = { exact: 0, prefix: 1, partial: 2 };
  const hits = [];
  for (const company of companies) {
    const k = companyCoreKey(company.name);
    if (!k) continue;
    let match = null;
    if (k === q) match = 'exact';
    else if (k.startsWith(q) || (k.length >= 2 && q.startsWith(k))) match = 'prefix';
    else if (k.includes(q) || (k.length >= 2 && q.includes(k))) match = 'partial';
    if (match) hits.push({ company, match });
  }
  hits.sort((a, b) =>
    rank[a.match] - rank[b.match] || companyCoreKey(a.company.name).length - companyCoreKey(b.company.name).length
  );
  return hits.slice(0, limit);
}
