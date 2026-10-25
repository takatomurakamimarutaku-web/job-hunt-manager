// 入力値の検証と整形（純粋関数）
// 各 validateXxx は { ok, errors: { 項目名: メッセージ }, value: 整形済みの値 } を返す

import { CHANNELS, LISTINGS } from './stages.js';

export const LIMITS = Object.freeze({
  name: 100,
  short: 100,
  url: 2048,
  long: 5000,
  tag: 30,
  tags: 20,
});

/** http/https の絶対URLのみ許可する（javascript: などを防ぐ） */
export function isSafeUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 空欄は null、整数でなければ NaN を返す（全角数字・カンマも受け付ける） */
export function toIntOrNull(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).normalize('NFKC').replace(/,/g, '').trim();
  if (s === '') return null;
  if (!/^-?\d+$/.test(s)) return NaN;
  return Number(s);
}

/**
 * datetime-local / date の入力値（端末の現地時刻）を UTC の ISO 文字列にする。
 * 空欄は null、解釈できない値は undefined
 */
export function toIsoOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const s = String(value).trim();
  // "YYYY-MM-DD" だけの場合は現地時刻の 0:00 として扱う（new Date は UTC として解釈するため）
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function text(value, max, field, errors, label, { required = false } = {}) {
  const v = value === null || value === undefined ? '' : String(value).trim();
  if (required && v === '') errors[field] = `${label}を入力してください`;
  else if (v.length > max) errors[field] = `${label}は${max}文字以内にしてください`;
  return v;
}

function url(value, field, errors, label) {
  const v = value === null || value === undefined ? '' : String(value).trim();
  if (v === '') return '';
  if (v.length > LIMITS.url) errors[field] = `${label}が長すぎます`;
  else if (!isSafeUrl(v)) errors[field] = `${label}は http:// または https:// で始まるURLを入力してください`;
  return v;
}

function int(value, field, errors, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = toIntOrNull(value);
  if (n === null) return null;
  if (Number.isNaN(n)) {
    errors[field] = `${label}は整数で入力してください`;
    return null;
  }
  if (n < min || n > max) {
    errors[field] = `${label}は${min}〜${max}の範囲で入力してください`;
    return null;
  }
  return n;
}

/** "a, b、c" や配列からタグ配列を作る（前後空白除去・空要素除去・重複除去） */
export function parseTags(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[,、，\n]/);
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const t = String(raw).trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export function validateCompany(input = {}) {
  const errors = {};
  const thisYear = new Date().getFullYear();
  const value = {
    name: text(input.name, LIMITS.name, 'name', errors, '企業名', { required: true }),
    industry: text(input.industry, LIMITS.short, 'industry', errors, '業種'),
    url: url(input.url, 'url', errors, 'URL'),
    location: text(input.location, LIMITS.short, 'location', errors, '所在地'),
    employees: int(input.employees, 'employees', errors, '従業員数', { min: 0, max: 10_000_000 }),
    founded: int(input.founded, 'founded', errors, '設立年', { min: 1800, max: thisYear + 1 }),
    listing: String(input.listing ?? ''),
    business: text(input.business, LIMITS.long, 'business', errors, '事業内容'),
    salaryMin: int(input.salaryMin, 'salaryMin', errors, '年収（下限）', { min: 0, max: 100_000 }),
    salaryMax: int(input.salaryMax, 'salaryMax', errors, '年収（上限）', { min: 0, max: 100_000 }),
    workStyle: text(input.workStyle, LIMITS.long, 'workStyle', errors, '働き方'),
    interestLevel: int(input.interestLevel, 'interestLevel', errors, '志望度', { min: 1, max: 5 }),
    tags: parseTags(input.tags),
    memo: text(input.memo, LIMITS.long, 'memo', errors, 'メモ'),
  };
  if (!LISTINGS.includes(value.listing)) errors.listing = '上場区分の値が不正です';
  if (value.salaryMin !== null && value.salaryMax !== null && value.salaryMin > value.salaryMax) {
    errors.salaryMax = '年収の上限は下限以上にしてください';
  }
  if (value.tags.length > LIMITS.tags) errors.tags = `タグは${LIMITS.tags}個までです`;
  else if (value.tags.some((t) => t.length > LIMITS.tag)) errors.tags = `タグは1つ${LIMITS.tag}文字以内にしてください`;
  return { ok: Object.keys(errors).length === 0, errors, value };
}

export function validateApplication(input = {}) {
  const errors = {};
  const companyId = String(input.companyId ?? '').trim();
  if (!companyId) errors.companyId = '企業を選択してください';
  const channel = String(input.channel || 'direct');
  if (!CHANNELS.includes(channel)) errors.channel = '応募経路の値が不正です';
  const appliedAt = toIsoOrNull(input.appliedAt);
  if (appliedAt === undefined) errors.appliedAt = '応募日の形式が正しくありません';
  const value = {
    companyId,
    position: text(input.position, LIMITS.short, 'position', errors, '職種'),
    channel,
    appliedAt: appliedAt ?? null,
    memo: text(input.memo, LIMITS.long, 'memo', errors, 'メモ'),
  };
  return { ok: Object.keys(errors).length === 0, errors, value };
}

/** 選考イベント（日時・場所・URL・メモ）の入力 */
export function validateEventInput(input = {}) {
  const errors = {};
  const scheduledAt = toIsoOrNull(input.scheduledAt);
  const endAt = toIsoOrNull(input.endAt);
  if (scheduledAt === undefined) errors.scheduledAt = '日時の形式が正しくありません';
  if (endAt === undefined) errors.endAt = '終了日時の形式が正しくありません';
  if (scheduledAt && endAt && endAt < scheduledAt) errors.endAt = '終了日時は開始日時より後にしてください';
  if (!scheduledAt && endAt) errors.endAt = '終了日時を入れる場合は開始日時も入力してください';
  const value = {
    scheduledAt: scheduledAt ?? null,
    endAt: endAt ?? null,
    place: text(input.place, LIMITS.short, 'place', errors, '場所'),
    onlineUrl: url(input.onlineUrl, 'onlineUrl', errors, 'オンラインURL'),
    memo: text(input.memo, LIMITS.long, 'memo', errors, 'メモ'),
  };
  return { ok: Object.keys(errors).length === 0, errors, value };
}

export class ValidationError extends Error {
  constructor(errors) {
    super(Object.values(errors)[0] || '入力内容を確認してください');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}
