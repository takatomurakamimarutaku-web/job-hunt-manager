// バックアップのエクスポート・インポート
// 全データ（添付ファイルを含む）を JSON にまとめ、必要ならパスワードで暗号化してファイルにする。

import { DB_VERSION, STORES, SETTINGS_KEY, run, get, getAll, put, readSettings, saveSettings } from './db.js';
import { normalize } from './search.js';
import { OFFER_STAGE_ID, sortStages } from './stages.js';
import { BackupError, encrypt, decrypt, isEncryptedBackup, toBase64, fromBase64 } from './crypto.js';

export { BackupError };

export const BACKUP_FORMAT = 'job-hunt-backup';
/** バックアップ形式のバージョン。中身の形を変えたら上げ、BACKUP_MIGRATIONS に変換を追加する */
export const BACKUP_VERSION = 1;
export const REMINDER_DAYS = 14;
export const MIN_PASSWORD_LENGTH = 8;

/**
 * 古いバージョンのバックアップを1つ新しい形に変換する関数。キー = 変換前のバージョン。
 * 例: 2: (data) => ({ ...data, version: 3, stores: { ...data.stores, newStore: [] } })
 */
export const BACKUP_MIGRATIONS = Object.freeze({});

const STORE_LABELS = {
  companies: '企業', applications: '応募', events: '選考イベント', tasks: 'タスク',
  taskTemplates: 'タスクのテンプレート', interviews: '面接記録', questions: '質問',
  documents: '応募書類', files: '添付ファイル', contacts: '担当者', settings: '設定',
};
export const storeLabel = (store) => STORE_LABELS[store] || store;

// ---------- エクスポート ----------

/** 全ストアを1つのトランザクションで読み、バックアップの中身を作る */
export async function collectBackup(db, { now = new Date(), appVersion = '' } = {}) {
  const raw = await run(db, STORES, 'readonly', async (tx) => {
    const out = {};
    for (const store of STORES) out[store] = await getAll(tx, store);
    return out;
  });
  // Blob の読み出しはトランザクションの外で行う（待機中にトランザクションが終了するため）
  const files = [];
  for (const f of raw.files) {
    const { blob, ...rest } = f;
    const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array(0);
    files.push({ ...rest, mimeType: f.mimeType || (blob && blob.type) || '', data: toBase64(bytes) });
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schemaVersion: DB_VERSION,
    appVersion,
    exportedAt: new Date(now).toISOString(),
    stores: { ...raw, files },
  };
}

const pad = (n) => String(n).padStart(2, '0');
export function backupFileName(now = new Date(), encrypted = true) {
  const d = new Date(now);
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `job-hunt-backup-${stamp}.${encrypted ? 'jhbak' : 'json'}`;
}

/**
 * バックアップファイルの中身を作る
 * @param {object} o { password, encrypted（既定 true）, now, appVersion, iterations }
 * @returns {Promise<{ bytes: Uint8Array, fileName: string, mimeType: string, data: object }>}
 */
export async function createBackupFile(db, { password = '', encrypted = true, now = new Date(), appVersion = '', iterations } = {}) {
  if (encrypted) {
    const err = validatePassword(password, password);
    if (err) throw new BackupError('weak-password', err);
  }
  const data = await collectBackup(db, { now, appVersion });
  const json = new TextEncoder().encode(JSON.stringify(data));
  const bytes = encrypted ? await encrypt(json, password, iterations ? { iterations } : undefined) : json;
  return {
    bytes,
    fileName: backupFileName(now, encrypted),
    mimeType: encrypted ? 'application/octet-stream' : 'application/json',
    data,
  };
}

/** パスワードの検証。問題があればメッセージ、なければ null */
export function validatePassword(password, confirm) {
  if (!password) return 'パスワードを入力してください';
  if (password.length < MIN_PASSWORD_LENGTH) return `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`;
  if (password !== confirm) return '確認用のパスワードが一致しません';
  return null;
}

/** エクスポートが終わったら最終バックアップ日時を記録する */
export function markBackedUp(db, now = new Date()) {
  return saveSettings(db, { lastBackupAt: new Date(now).toISOString() });
}

// ---------- 読み込みと検証 ----------

/**
 * ファイルの中身を読み、検証・変換済みのバックアップを返す。
 * 暗号化ファイルでパスワードが無い場合は code: 'need-password' の BackupError
 */
export async function readBackupFile(bytes, password = '', options = {}) {
  let json;
  if (isEncryptedBackup(bytes)) {
    if (!password) throw new BackupError('need-password', 'このファイルは暗号化されています。パスワードを入力してください');
    json = await decrypt(bytes, password);
  } else {
    json = bytes;
  }
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(json).replace(/^﻿/, ''));
  } catch {
    throw new BackupError('not-backup', 'このアプリのバックアップファイルではありません（読み取れない形式です）');
  }
  return validateBackup(upgradeBackup(checkVersion(data, options), options), options);
}

function checkVersion(data, { targetVersion = BACKUP_VERSION, schemaVersion = DB_VERSION } = {}) {
  if (!data || typeof data !== 'object' || data.format !== BACKUP_FORMAT) {
    throw new BackupError('not-backup', 'このアプリのバックアップファイルではありません');
  }
  if (!Number.isInteger(data.version) || data.version < 1) throw new BackupError('corrupted', 'ファイルが壊れています（バージョン情報が不正です）');
  if (data.version > targetVersion || (Number.isInteger(data.schemaVersion) && data.schemaVersion > schemaVersion)) {
    throw new BackupError('too-new', '新しいバージョンのアプリで作成されたファイルです。アプリを更新してから読み込んでください');
  }
  return data;
}

/** 古いバージョンのバックアップを現在の形に変換する（純粋関数） */
export function upgradeBackup(data, { targetVersion = BACKUP_VERSION, migrations = BACKUP_MIGRATIONS } = {}) {
  let current = data;
  while (current.version < targetVersion) {
    const migrate = migrations[current.version];
    if (!migrate) throw new BackupError('unsupported', `バージョン${current.version}のバックアップには対応していません`);
    const next = migrate(current);
    if (!next || next.version <= current.version) throw new BackupError('unsupported', 'バックアップの変換に失敗しました');
    current = next;
  }
  return current;
}

/** 形式・ストア・各レコードの形を検証する（純粋関数）。問題がなければ data を返す */
export function validateBackup(data, { stores = STORES } = {}) {
  checkVersion(data, { targetVersion: Number.POSITIVE_INFINITY, schemaVersion: Number.POSITIVE_INFINITY });
  if (!data.stores || typeof data.stores !== 'object') throw new BackupError('corrupted', 'ファイルが壊れています（データ本体がありません）');
  for (const store of stores) {
    const list = data.stores[store];
    if (!Array.isArray(list)) throw new BackupError('corrupted', `ファイルが壊れています（${storeLabel(store)}のデータがありません）`);
    const keyName = store === 'settings' ? 'key' : 'id';
    const seen = new Set();
    for (const record of list) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new BackupError('corrupted', `ファイルが壊れています（${storeLabel(store)}のデータが不正です）`);
      }
      const key = record[keyName];
      if (typeof key !== 'string' || key === '') throw new BackupError('corrupted', `ファイルが壊れています（${storeLabel(store)}に ID のないデータがあります）`);
      if (seen.has(key)) throw new BackupError('corrupted', `ファイルが壊れています（${storeLabel(store)}の ID が重複しています）`);
      seen.add(key);
      if (store === 'files' && typeof record.data !== 'string') throw new BackupError('corrupted', 'ファイルが壊れています（添付ファイルのデータがありません）');
    }
  }
  return data;
}

/** プレビュー用：各ストアの件数 */
export function summarizeBackup(data) {
  return Object.fromEntries(STORES.filter((s) => s !== 'settings').map((s) => [s, (data.stores[s] || []).length]));
}

// ---------- インポート ----------

/** 保存用のレコードに戻す（添付ファイルを Blob に、正規化キーを作り直す） */
function restoreRecord(store, record) {
  switch (store) {
    case 'files': {
      const { data, ...rest } = record;
      return { ...rest, blob: new Blob([fromBase64(data)], { type: record.mimeType || '' }) };
    }
    case 'companies':
    case 'contacts':
      return { ...record, nameKey: normalize(record.name ?? '') };
    case 'questions':
      return { ...record, textKey: normalize(record.text ?? '') };
    default:
      return record;
  }
}

const stamp = (r) => r.updatedAt || r.createdAt || '';

/** 取り込むバックアップの段階のうち、端末にないものを「内定」の直前に追加する */
export function mergeStages(current, imported = []) {
  const ids = new Set(current.map((s) => s.id));
  const extra = sortStages(imported).filter((s) => !ids.has(s.id));
  if (extra.length === 0) return sortStages(current);
  const sorted = sortStages(current);
  const offerIndex = sorted.findIndex((s) => s.id === OFFER_STAGE_ID);
  const at = offerIndex >= 0 ? offerIndex : sorted.length;
  return [...sorted.slice(0, at), ...extra, ...sorted.slice(at)].map((s, i) => ({ ...s, order: i }));
}

/**
 * バックアップを取り込む。全ストアを1つのトランザクションで書き込み、失敗時は何も変わらない。
 * - merge（既存データに追加）：同じ ID は更新日時が新しい方を残す。設定は端末側を残し、足りない段階だけ追加
 * - replace（置き換え）：全データを削除してからバックアップの内容を書き込む
 * @returns {{ added: number, updated: number, skipped: number, deleted: number }}
 */
export async function importBackup(db, data, { mode = 'merge' } = {}) {
  if (mode !== 'merge' && mode !== 'replace') throw new Error('取り込み方法が不正です');
  validateBackup(data);
  // Blob の生成などはトランザクションの前に済ませる
  const prepared = {};
  for (const store of STORES) {
    if (store === 'settings') continue;
    prepared[store] = data.stores[store].map((r) => restoreRecord(store, r));
  }
  const importedSettings = data.stores.settings.find((s) => s.key === SETTINGS_KEY) || null;

  return run(db, STORES, 'readwrite', async (tx) => {
    const result = { added: 0, updated: 0, skipped: 0, deleted: 0 };
    const current = await readSettings(tx);
    if (mode === 'replace') {
      for (const store of STORES) {
        result.deleted += (await getAll(tx, store)).length;
        await new Promise((resolve, reject) => {
          const r = tx.objectStore(store).clear();
          r.onsuccess = resolve;
          r.onerror = () => reject(r.error);
        });
      }
      for (const store of Object.keys(prepared)) {
        for (const record of prepared[store]) {
          await put(tx, store, record);
          result.added++;
        }
      }
      const lastBackupAt = [importedSettings && importedSettings.lastBackupAt, data.exportedAt].filter(Boolean).sort().at(-1) || null;
      await put(tx, 'settings', {
        ...current,
        ...(importedSettings || {}),
        stages: importedSettings && Array.isArray(importedSettings.stages) ? sortStages(importedSettings.stages) : current.stages,
        lastBackupAt,
        key: SETTINGS_KEY,
      });
      return result;
    }

    for (const store of Object.keys(prepared)) {
      for (const record of prepared[store]) {
        const existing = await get(tx, store, record.id);
        if (!existing) {
          await put(tx, store, record);
          result.added++;
        } else if (stamp(record) > stamp(existing)) {
          await put(tx, store, record);
          result.updated++;
        } else {
          result.skipped++;
        }
      }
    }
    if (importedSettings && Array.isArray(importedSettings.stages)) {
      await put(tx, 'settings', { ...current, stages: mergeStages(current.stages, importedSettings.stages), key: SETTINGS_KEY });
    }
    return result;
  });
}

// ---------- 案内・保存領域 ----------

/** ホームに「バックアップしましょう」と出すか（データがあり、14日以上または一度もバックアップしていない） */
export function needsBackupReminder(lastBackupAt, hasData, now = new Date()) {
  if (!hasData) return false;
  if (!lastBackupAt) return true;
  const elapsed = new Date(now).getTime() - new Date(lastBackupAt).getTime();
  return !(elapsed < REMINDER_DAYS * 86_400_000);
}

/** 保存領域の使用量と永続化の状態（ブラウザのみ） */
export async function getStorageStatus() {
  const storage = globalThis.navigator && navigator.storage;
  const status = { usage: null, quota: null, persisted: null };
  if (!storage) return status;
  try {
    if (storage.estimate) {
      const { usage, quota } = await storage.estimate();
      status.usage = usage ?? null;
      status.quota = quota ?? null;
    }
    if (storage.persisted) status.persisted = await storage.persisted();
  } catch { /* 取得できない環境では null のまま */ }
  return status;
}

/** 永続化（ブラウザが自動でデータを消さないようにする）を要求する。結果: true / false / null（非対応） */
export async function requestPersistence() {
  const storage = globalThis.navigator && navigator.storage;
  if (!storage || !storage.persist) return null;
  try {
    if (storage.persisted && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

export function formatBytes(n) {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
