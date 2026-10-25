// IndexedDB 操作（スキーマ定義・移行・CRUD・連鎖削除と復元）
// すべての関数は第1引数に db（IDBDatabase）を受け取る。テストでは fake-indexeddb を openDB に渡す。

import { normalize } from './search.js';
import { cloneDefaultStages, isClosed } from './stages.js';
import { validateCompany, ValidationError } from './validate.js';

export const DB_NAME = 'job-hunt';
export const DB_VERSION = 1;
export const SETTINGS_KEY = 'app';

export const STORES = Object.freeze([
  'companies', 'applications', 'events', 'tasks', 'taskTemplates',
  'interviews', 'questions', 'documents', 'files', 'contacts', 'settings',
]);

/**
 * スキーマ移行。キー = 移行後のバージョン。
 * バージョンを上げるときは DB_VERSION を増やし、ここに関数を1つ追加してテストを書く。
 */
export const MIGRATIONS = Object.freeze({
  1(db) {
    const store = (name, indexes = [], keyPath = 'id') => {
      const s = db.createObjectStore(name, { keyPath });
      for (const idx of indexes) s.createIndex(idx, idx);
    };
    store('companies', ['nameKey', 'updatedAt']);
    store('applications', ['companyId', 'stage', 'state', 'updatedAt']);
    store('events', ['applicationId', 'scheduledAt']);
    // done は 0/1 で保存する（boolean はインデックスのキーにできないため）
    store('tasks', ['dueAt', 'done', 'applicationId', 'companyId', 'sourceEventId']);
    store('taskTemplates');
    store('interviews', ['applicationId', 'eventId']);
    store('questions', ['textKey']);
    store('documents', ['type', 'parentId']);
    store('files');
    store('contacts', ['nameKey', 'companyId']);
    store('settings', [], 'key');
  },
});

/**
 * DB を開く（必要なら移行を実行する）
 * @param {object} [options]
 * @param {IDBFactory} [options.indexedDB] テストでは fake-indexeddb を渡す
 */
export function openDB({
  indexedDB = globalThis.indexedDB,
  name = DB_NAME,
  version = DB_VERSION,
  migrations = MIGRATIONS,
} = {}) {
  return new Promise((resolve, reject) => {
    if (!indexedDB) {
      reject(new Error('この環境では IndexedDB を使用できません'));
      return;
    }
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = (e) => {
      const db = request.result;
      const tx = request.transaction;
      for (let v = e.oldVersion + 1; v <= e.newVersion; v++) {
        const migrate = migrations[v];
        if (!migrate) throw new Error(`バージョン${v}への移行処理がありません`);
        migrate(db, tx, e.oldVersion);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // 別のタブで新しいバージョンが開かれたら閉じて、移行を妨げないようにする
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('他のタブでアプリが開かれているため、データベースを更新できません。他のタブを閉じてください'));
  });
}

// ---------- 低レベルヘルパー ----------

export function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * トランザクションを開いて fn(tx) を実行し、完了（commit）を待って fn の戻り値を返す。
 * fn が例外を投げた場合は abort し、何も書き込まない。
 */
export function run(db, storeNames, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    tx.oncomplete = () => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    tx.onabort = () => fail(tx.error || new Error('保存処理が中断されました'));
    Promise.resolve()
      .then(() => fn(tx))
      .then(
        (r) => { result = r; },
        (err) => {
          fail(err);
          try { tx.abort(); } catch { /* すでに終了している */ }
        }
      );
  });
}

export const get = (tx, store, key) => req(tx.objectStore(store).get(key));
export const getAll = (tx, store) => req(tx.objectStore(store).getAll());
export const getAllByIndex = (tx, store, index, key) => req(tx.objectStore(store).index(index).getAll(key));
export const put = (tx, store, value) => req(tx.objectStore(store).put(value));
export const del = (tx, store, key) => req(tx.objectStore(store).delete(key));

const newId = () => crypto.randomUUID();
const nowIso = (now) => (now ? new Date(now) : new Date()).toISOString();

// ---------- 初期値の生成（後のフェーズで使う項目も含めて全項目を持たせる） ----------

export function newCompany(value = {}, now) {
  const t = nowIso(now);
  return {
    id: newId(),
    name: '', nameKey: '', industry: '', url: '', location: '',
    employees: null, founded: null, listing: '', business: '',
    strengths: '', weaknesses: '', competitors: '',
    salaryMin: null, salaryMax: null, workStyle: '', interestLevel: null,
    tags: [], memo: '',
    financials: [], sources: [], scores: {},
    createdAt: t, updatedAt: t,
    ...value,
    nameKey: normalize(value.name ?? ''),
  };
}

export function newApplication(value = {}, now) {
  const t = nowIso(now);
  return {
    id: newId(),
    companyId: '', position: '', channel: 'direct', agentContactId: null,
    appliedAt: null, stage: 'interest', state: 'planned', documentIds: [], memo: '',
    createdAt: t, updatedAt: t,
    ...value,
  };
}

export function newEvent(value = {}, now) {
  return {
    id: newId(),
    applicationId: '', stage: '', state: '',
    scheduledAt: null, endAt: null, place: '', onlineUrl: '', memo: '',
    createdAt: nowIso(now),
    ...value,
  };
}

// ---------- 設定 ----------

export const DEFAULT_SCORE_AXES = Object.freeze([
  { id: 'salary', name: '年収', weight: 3 },
  { id: 'growth', name: '成長性', weight: 3 },
  { id: 'stability', name: '安定性', weight: 3 },
  { id: 'workstyle', name: '働き方', weight: 3 },
  { id: 'skill', name: '技術・スキル', weight: 3 },
  { id: 'commute', name: '通勤・立地', weight: 3 },
  { id: 'culture', name: '社風', weight: 3 },
]);

export function defaultSettings() {
  return {
    key: SETTINGS_KEY,
    stages: cloneDefaultStages(),
    scoreAxes: DEFAULT_SCORE_AXES.map((a) => ({ ...a })),
    lastBackupAt: null,
  };
}

/** トランザクション内で設定を読む（未作成なら既定値。新しい既定項目は補完する） */
export async function readSettings(tx) {
  const stored = await get(tx, 'settings', SETTINGS_KEY);
  return { ...defaultSettings(), ...(stored || {}) };
}

export function getSettings(db) {
  return run(db, ['settings'], 'readonly', (tx) => readSettings(tx));
}

/** 設定を部分更新して保存し、保存後の設定を返す */
export function saveSettings(db, patch) {
  return run(db, ['settings'], 'readwrite', async (tx) => {
    const next = { ...(await readSettings(tx)), ...patch, key: SETTINGS_KEY };
    await put(tx, 'settings', next);
    return next;
  });
}

/** 初回起動時に既定の設定を保存する */
export function ensureSettings(db) {
  return run(db, ['settings'], 'readwrite', async (tx) => {
    const stored = await get(tx, 'settings', SETTINGS_KEY);
    if (stored) return { ...defaultSettings(), ...stored };
    const s = defaultSettings();
    await put(tx, 'settings', s);
    return s;
  });
}

// ---------- 企業 ----------

/**
 * 企業を登録・更新する。input.id があれば更新（入力対象外の項目は保持）。
 * @throws {ValidationError}
 */
export function saveCompany(db, input, { now } = {}) {
  const { ok, errors, value } = validateCompany(input);
  if (!ok) return Promise.reject(new ValidationError(errors));
  return run(db, ['companies'], 'readwrite', async (tx) => {
    let record;
    if (input.id) {
      const existing = await get(tx, 'companies', input.id);
      if (!existing) throw new Error('企業が見つかりません');
      record = { ...existing, ...value, nameKey: normalize(value.name), updatedAt: nowIso(now) };
    } else {
      record = newCompany(value, now);
    }
    await put(tx, 'companies', record);
    return record;
  });
}

export function getCompany(db, id) {
  return run(db, ['companies'], 'readonly', (tx) => get(tx, 'companies', id));
}

/** 企業一覧（名前の正規化キー順） */
export function listCompanies(db) {
  return run(db, ['companies'], 'readonly', async (tx) => {
    const list = await getAll(tx, 'companies');
    return list.sort((a, b) => a.nameKey.localeCompare(b.nameKey, 'ja'));
  });
}

// ---------- 応募 ----------

export function getApplication(db, id) {
  return run(db, ['applications'], 'readonly', (tx) => get(tx, 'applications', id));
}

export function listApplications(db) {
  return run(db, ['applications'], 'readonly', (tx) => getAll(tx, 'applications'));
}

export function listApplicationsByCompany(db, companyId) {
  return run(db, ['applications'], 'readonly', async (tx) => {
    const list = await getAllByIndex(tx, 'applications', 'companyId', companyId);
    return list.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
  });
}

export function listEventsByApplication(db, applicationId) {
  return run(db, ['events'], 'readonly', async (tx) => {
    const list = await getAllByIndex(tx, 'events', 'applicationId', applicationId);
    return list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  });
}

export function listEvents(db) {
  return run(db, ['events'], 'readonly', (tx) => getAll(tx, 'events'));
}

// ---------- 削除と「元に戻す」 ----------

const uniqById = (list) => [...new Map(list.map((x) => [x.id, x])).values()];

/** 応募に紐づくイベント・面接記録・タスクを集める */
async function collectApplicationGraph(tx, applicationId) {
  const [events, interviews, tasks] = await Promise.all([
    getAllByIndex(tx, 'events', 'applicationId', applicationId),
    getAllByIndex(tx, 'interviews', 'applicationId', applicationId),
    getAllByIndex(tx, 'tasks', 'applicationId', applicationId),
  ]);
  return { events, interviews, tasks };
}

/** 企業に紐づく全データを集める（応募・イベント・タスク・面接記録・担当者） */
async function collectCompanyGraph(tx, companyId) {
  const company = await get(tx, 'companies', companyId);
  if (!company) throw new Error('企業が見つかりません');
  const applications = await getAllByIndex(tx, 'applications', 'companyId', companyId);
  const events = [];
  const interviews = [];
  const tasks = await getAllByIndex(tx, 'tasks', 'companyId', companyId);
  for (const app of applications) {
    const g = await collectApplicationGraph(tx, app.id);
    events.push(...g.events);
    interviews.push(...g.interviews);
    tasks.push(...g.tasks);
  }
  const contacts = await getAllByIndex(tx, 'contacts', 'companyId', companyId);
  return { companies: [company], applications, events, tasks: uniqById(tasks), interviews, contacts };
}

const COMPANY_GRAPH_STORES = ['companies', 'applications', 'events', 'tasks', 'interviews', 'contacts'];

/** 確認ダイアログ用：企業を削除したときに消えるデータの件数 */
export function countCompanyCascade(db, companyId) {
  return run(db, COMPANY_GRAPH_STORES, 'readonly', async (tx) => {
    const g = await collectCompanyGraph(tx, companyId);
    return {
      applications: g.applications.length,
      events: g.events.length,
      tasks: g.tasks.length,
      interviews: g.interviews.length,
      contacts: g.contacts.length,
    };
  });
}

/**
 * 企業と、紐づく応募・イベント・タスク・面接記録を削除する。
 * 担当者は他社の応募でも使うため削除せず、企業との紐づけ（companyId）だけを外す。
 * @returns 元に戻すためのスナップショット（削除・変更前のレコード）
 */
export function deleteCompany(db, companyId, { now } = {}) {
  return run(db, COMPANY_GRAPH_STORES, 'readwrite', async (tx) => {
    const snapshot = await collectCompanyGraph(tx, companyId);
    const t = nowIso(now);
    for (const c of snapshot.contacts) await put(tx, 'contacts', { ...c, companyId: null, updatedAt: t });
    for (const x of snapshot.interviews) await del(tx, 'interviews', x.id);
    for (const x of snapshot.tasks) await del(tx, 'tasks', x.id);
    for (const x of snapshot.events) await del(tx, 'events', x.id);
    for (const x of snapshot.applications) await del(tx, 'applications', x.id);
    await del(tx, 'companies', companyId);
    return snapshot;
  });
}

const APPLICATION_GRAPH_STORES = ['applications', 'events', 'tasks', 'interviews'];

export function countApplicationCascade(db, applicationId) {
  return run(db, APPLICATION_GRAPH_STORES, 'readonly', async (tx) => {
    const g = await collectApplicationGraph(tx, applicationId);
    return { events: g.events.length, tasks: g.tasks.length, interviews: g.interviews.length };
  });
}

/** 応募と、紐づくイベント・タスク・面接記録を削除する */
export function deleteApplication(db, applicationId) {
  return run(db, APPLICATION_GRAPH_STORES, 'readwrite', async (tx) => {
    const app = await get(tx, 'applications', applicationId);
    if (!app) throw new Error('応募が見つかりません');
    const g = await collectApplicationGraph(tx, applicationId);
    for (const x of g.interviews) await del(tx, 'interviews', x.id);
    for (const x of g.tasks) await del(tx, 'tasks', x.id);
    for (const x of g.events) await del(tx, 'events', x.id);
    await del(tx, 'applications', applicationId);
    return { applications: [app], ...g };
  });
}

/** 削除時のスナップショットを1つのトランザクションで書き戻す */
export function restoreSnapshot(db, snapshot) {
  const stores = Object.keys(snapshot).filter((k) => STORES.includes(k) && snapshot[k].length > 0);
  if (stores.length === 0) return Promise.resolve();
  return run(db, stores, 'readwrite', async (tx) => {
    for (const store of stores) {
      for (const record of snapshot[store]) await put(tx, store, record);
    }
  });
}

// ---------- ホーム ----------

/** 応募ごとの最新イベント（createdAt が最大のもの） */
export function latestEventByApplication(events) {
  const map = new Map();
  for (const e of events) {
    const cur = map.get(e.applicationId);
    if (!cur || e.createdAt > cur.createdAt) map.set(e.applicationId, e);
  }
  return map;
}

/**
 * ホームの表示内容を集計する（純粋関数）
 * - 進行中：終了（不合格・辞退）でも内定承諾でもない応募
 * - 内定：内定の段階で終了していない応募（承諾済みを含む）
 * - 直近の予定：進行中の応募の最新イベントのうち、終了時刻（なければ開始時刻）が現在以降のもの
 */
export function summarizeHome({ companies, applications, events }, now = new Date(), limit = 5) {
  const nowStr = new Date(now).toISOString();
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const active = applications.filter((a) => !isClosed(a.state) && a.state !== 'accepted');
  const latest = latestEventByApplication(events);
  const upcoming = [];
  for (const app of active) {
    const ev = latest.get(app.id);
    if (!ev || !ev.scheduledAt) continue;
    if ((ev.endAt || ev.scheduledAt) < nowStr) continue;
    upcoming.push({ event: ev, application: app, company: companyById.get(app.companyId) || null });
  }
  upcoming.sort((a, b) => (a.event.scheduledAt < b.event.scheduledAt ? -1 : 1));
  return {
    activeCount: active.length,
    offerCount: applications.filter((a) => a.stage === 'offer' && !isClosed(a.state)).length,
    closedCount: applications.filter((a) => isClosed(a.state)).length,
    upcoming: upcoming.slice(0, limit),
  };
}

export function getHomeSummary(db, now = new Date(), limit = 5) {
  return run(db, ['companies', 'applications', 'events'], 'readonly', async (tx) => {
    const [companies, applications, events] = await Promise.all([
      getAll(tx, 'companies'), getAll(tx, 'applications'), getAll(tx, 'events'),
    ]);
    return summarizeHome({ companies, applications, events }, now, limit);
  });
}

// ---------- 件数 ----------

/** 各ストアの件数（バックアップ画面の表示と、置き換え前の確認に使う） */
export function countAll(db) {
  return run(db, STORES, 'readonly', async (tx) => {
    const out = {};
    for (const store of STORES) out[store] = await req(tx.objectStore(store).count());
    return out;
  });
}
