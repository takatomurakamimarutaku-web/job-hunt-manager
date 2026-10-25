import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSafeUrl, toIntOrNull, toIsoOrNull, parseTags,
  validateCompany, validateApplication, validateEventInput, ValidationError,
} from '../js/validate.js';
import { SAMPLE_COMPANY } from './helpers.js';

test('isSafeUrl: http/https のみ許可する', () => {
  assert.ok(isSafeUrl('https://example.com/path?q=1'));
  assert.ok(isSafeUrl('http://example.com'));
  assert.ok(!isSafeUrl('javascript:alert(1)'));
  assert.ok(!isSafeUrl('data:text/html,<b>x</b>'));
  assert.ok(!isSafeUrl('example.com'));
  assert.ok(!isSafeUrl(''));
  assert.ok(!isSafeUrl(null));
});

test('toIntOrNull: 空欄は null、全角・カンマ付きも整数にする', () => {
  assert.equal(toIntOrNull(''), null);
  assert.equal(toIntOrNull(null), null);
  assert.equal(toIntOrNull('１，２００'), 1200);
  assert.equal(toIntOrNull(' 42 '), 42);
  assert.ok(Number.isNaN(toIntOrNull('1.5')));
  assert.ok(Number.isNaN(toIntOrNull('abc')));
});

test('toIsoOrNull: 現地時刻を UTC の ISO 文字列にする', () => {
  assert.equal(toIsoOrNull(''), null);
  assert.equal(toIsoOrNull('2026-11-01T10:00'), new Date(2026, 10, 1, 10, 0).toISOString());
  assert.equal(toIsoOrNull('2026-11-01'), new Date(2026, 10, 1).toISOString());
  assert.equal(toIsoOrNull('2026-11-01T01:00:00.000Z'), '2026-11-01T01:00:00.000Z');
  assert.equal(toIsoOrNull('not a date'), undefined);
});

test('parseTags: 区切り文字・重複・空要素を整理する', () => {
  assert.deepEqual(parseTags('SaaS, リモート、SaaS,, フレックス'), ['SaaS', 'リモート', 'フレックス']);
  assert.deepEqual(parseTags(['a', ' a ', 'b']), ['a', 'b']);
  assert.deepEqual(parseTags(''), []);
});

test('validateCompany: 正常な入力を整形する', () => {
  const r = validateCompany(SAMPLE_COMPANY);
  assert.equal(r.ok, true);
  assert.equal(r.value.employees, 120);
  assert.equal(r.value.salaryMin, 500);
  assert.equal(r.value.interestLevel, 4);
  assert.deepEqual(r.value.tags, ['SaaS', 'リモート']);
});

test('validateCompany: 企業名は必須・100文字以内', () => {
  assert.ok(validateCompany({ name: '  ' }).errors.name);
  assert.ok(validateCompany({ name: 'あ'.repeat(101) }).errors.name);
  assert.equal(validateCompany({ name: 'あ'.repeat(100) }).ok, true);
});

test('validateCompany: URL・数値・範囲の検証', () => {
  assert.ok(validateCompany({ name: 'x', url: 'javascript:alert(1)' }).errors.url);
  assert.ok(validateCompany({ name: 'x', employees: '-1' }).errors.employees);
  assert.ok(validateCompany({ name: 'x', employees: '12.5' }).errors.employees);
  assert.ok(validateCompany({ name: 'x', founded: '1700' }).errors.founded);
  assert.ok(validateCompany({ name: 'x', interestLevel: '6' }).errors.interestLevel);
  assert.ok(validateCompany({ name: 'x', interestLevel: '0' }).errors.interestLevel);
  assert.ok(validateCompany({ name: 'x', listing: '不明な区分' }).errors.listing);
});

test('validateCompany: 年収の上限が下限より小さいとエラー', () => {
  assert.ok(validateCompany({ name: 'x', salaryMin: '800', salaryMax: '500' }).errors.salaryMax);
  assert.equal(validateCompany({ name: 'x', salaryMin: '500', salaryMax: '500' }).ok, true);
  assert.equal(validateCompany({ name: 'x', salaryMin: '500' }).ok, true);
});

test('validateCompany: 未入力の数値は null（0 と区別する）', () => {
  const r = validateCompany({ name: 'x', employees: '', salaryMin: '0' });
  assert.equal(r.value.employees, null);
  assert.equal(r.value.salaryMin, 0);
});

test('validateCompany: タグの個数・長さ', () => {
  assert.ok(validateCompany({ name: 'x', tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }).errors.tags);
  assert.ok(validateCompany({ name: 'x', tags: ['あ'.repeat(31)] }).errors.tags);
});

test('validateApplication: 企業必須・応募経路の列挙値・応募日', () => {
  assert.ok(validateApplication({}).errors.companyId);
  assert.ok(validateApplication({ companyId: 'c', channel: 'unknown' }).errors.channel);
  assert.ok(validateApplication({ companyId: 'c', appliedAt: 'xx' }).errors.appliedAt);
  const r = validateApplication({ companyId: 'c', appliedAt: '2026-10-01', position: ' エンジニア ' });
  assert.equal(r.ok, true);
  assert.equal(r.value.channel, 'direct');
  assert.equal(r.value.position, 'エンジニア');
});

test('validateEventInput: 日時の前後関係とURL', () => {
  assert.ok(validateEventInput({ scheduledAt: '2026-11-01T10:00', endAt: '2026-11-01T09:00' }).errors.endAt);
  assert.ok(validateEventInput({ endAt: '2026-11-01T09:00' }).errors.endAt);
  assert.ok(validateEventInput({ onlineUrl: 'javascript:void(0)' }).errors.onlineUrl);
  const r = validateEventInput({ scheduledAt: '2026-11-01T10:00', endAt: '2026-11-01T11:00', place: '本社' });
  assert.equal(r.ok, true);
  assert.equal(validateEventInput({}).ok, true);
});

test('ValidationError: 最初のエラーをメッセージにする', () => {
  const e = new ValidationError({ name: '企業名を入力してください' });
  assert.equal(e.message, '企業名を入力してください');
  assert.equal(e.name, 'ValidationError');
});
