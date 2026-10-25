import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, hiraganaToKatakana, matches, companyCoreKey, findSimilarCompanies } from '../js/search.js';

test('normalize: 全角英数は半角、大文字は小文字になる', () => {
  assert.equal(normalize('ＡＢＣ１２３'), 'abc123');
  assert.equal(normalize('Hello World'), 'hello world');
});

test('normalize: 半角カナは全角カタカナ、ひらがなはカタカナになる', () => {
  assert.equal(normalize('ｻﾝﾌﾟﾙ'), 'サンプル');
  assert.equal(normalize('さんぷる'), 'サンプル');
  assert.equal(normalize('ばびぶゔ'), 'バビブヴ');
});

test('normalize: 全角スペース・連続空白・前後の空白を整理する', () => {
  assert.equal(normalize('  架空　　商事\t株式会社 \n'), '架空 商事 株式会社');
});

test('normalize: null / undefined / 数値', () => {
  assert.equal(normalize(null), '');
  assert.equal(normalize(undefined), '');
  assert.equal(normalize(123), '123');
});

test('hiraganaToKatakana: ひらがな以外はそのまま', () => {
  assert.equal(hiraganaToKatakana('あア亜a'), 'アア亜a');
});

test('matches: 空白区切りはAND、表記ゆれを吸収する', () => {
  assert.ok(matches('株式会社サンプル商事', 'さんぷる'));
  assert.ok(matches('株式会社サンプル商事', 'ｻﾝﾌﾟﾙ 商事'));
  assert.ok(!matches('株式会社サンプル商事', 'サンプル 物産'));
  assert.ok(matches('なんでも', ''));
});

test('companyCoreKey: 法人格を除いて比較する', () => {
  assert.equal(companyCoreKey('株式会社 サンプル商事'), companyCoreKey('サンプル商事（株）'));
  assert.equal(companyCoreKey('㈱サンプル商事'), 'サンプル商事');
});

test('findSimilarCompanies: 完全一致→前方一致→部分一致の順に返す', () => {
  const companies = [
    { id: '1', name: '東京サンプル商事' },
    { id: '2', name: 'サンプル商事ホールディングス' },
    { id: '3', name: '株式会社サンプル商事' },
    { id: '4', name: '架空物産' },
  ];
  const hits = findSimilarCompanies(companies, 'さんぷる商事');
  assert.deepEqual(hits.map((h) => [h.company.id, h.match]), [
    ['3', 'exact'], ['2', 'prefix'], ['1', 'partial'],
  ]);
});

test('findSimilarCompanies: 空入力・該当なし・件数制限', () => {
  const companies = Array.from({ length: 10 }, (_, i) => ({ id: String(i), name: `テスト${i}社` }));
  assert.deepEqual(findSimilarCompanies(companies, ''), []);
  assert.deepEqual(findSimilarCompanies(companies, '存在しない'), []);
  assert.equal(findSimilarCompanies(companies, 'テスト', 3).length, 3);
});

test('findSimilarCompanies: 1文字の既存企業名は逆方向の部分一致に使わない', () => {
  const hits = findSimilarCompanies([{ id: '1', name: 'A' }], 'サンプルA商事');
  assert.equal(hits.length, 0);
});
