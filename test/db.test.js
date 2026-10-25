import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {
  openDB, DB_NAME, DB_VERSION, MIGRATIONS, STORES, run, put, getAll,
  saveCompany, getCompany, listCompanies, ensureSettings, getSettings, saveSettings,
  listApplicationsByCompany, listEventsByApplication, getApplication, listApplications,
  countCompanyCascade, deleteCompany, deleteApplication, countApplicationCascade, restoreSnapshot,
  summarizeHome, getHomeSummary, newCompany,
} from '../js/db.js';
import { createApplication, changeStatus } from '../js/status.js';
import { freshDB, SAMPLE_COMPANY } from './helpers.js';

const T0 = new Date('2026-10-01T00:00:00.000Z');

test('openDB: DB名 job-hunt、全ストアとインデックスを作成する', async () => {
  const db = await freshDB();
  assert.equal(db.name, DB_NAME);
  assert.equal(db.version, DB_VERSION);
  assert.deepEqual([...db.objectStoreNames].sort(), [...STORES].sort());
  const tx = db.transaction(STORES, 'readonly');
  const indexes = (s) => [...tx.objectStore(s).indexNames].sort();
  assert.deepEqual(indexes('applications'), ['companyId', 'stage', 'state', 'updatedAt']);
  assert.deepEqual(indexes('events'), ['applicationId', 'scheduledAt']);
  assert.deepEqual(indexes('tasks'), ['applicationId', 'companyId', 'done', 'dueAt', 'sourceEventId']);
  assert.deepEqual(indexes('companies'), ['nameKey', 'updatedAt']);
  assert.equal(tx.objectStore('settings').keyPath, 'key');
  db.close();
});

test('移行: 旧バージョンのDBを開き直すと、不足分の移行だけが順に実行される', async () => {
  const factory = new IDBFactory();
  const v1 = await openDB({ indexedDB: factory });
  await saveCompany(v1, SAMPLE_COMPANY, { now: T0 });
  v1.close();

  // テスト用の仮の v2 移行：既存データに項目を追加し、インデックスを作る
  const calls = [];
  const migrations = {
    1: (db, tx, old) => { calls.push([1, old]); MIGRATIONS[1](db, tx); },
    2: (db, tx, old) => {
      calls.push([2, old]);
      const store = tx.objectStore('companies');
      store.createIndex('interestLevel', 'interestLevel');
      store.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        cursor.update({ ...cursor.value, migratedV2: true });
        cursor.continue();
      };
    },
  };
  const v2 = await openDB({ indexedDB: factory, version: 2, migrations });
  assert.deepEqual(calls, [[2, 1]]);
  const [company] = await listCompanies(v2);
  assert.equal(company.migratedV2, true);
  assert.equal(company.name, SAMPLE_COMPANY.name);
  v2.close();
});

test('移行: 移行処理が無いバージョンは開けない', async () => {
  await assert.rejects(openDB({ indexedDB: new IDBFactory(), version: 2, migrations: { 1: MIGRATIONS[1] } }));
});

test('run: 途中で例外が出たら何も書き込まない', async () => {
  const db = await freshDB();
  await assert.rejects(run(db, ['companies'], 'readwrite', async (tx) => {
    await put(tx, 'companies', newCompany({ name: 'x' }));
    throw new Error('失敗');
  }), /失敗/);
  assert.equal((await listCompanies(db)).length, 0);
});

test('settings: 初回は既定値を保存し、部分更新できる', async () => {
  const db = await freshDB();
  const s = await ensureSettings(db);
  assert.equal(s.stages.length, 7);
  assert.equal(s.scoreAxes.length, 7);
  assert.equal(s.lastBackupAt, null);
  await saveSettings(db, { lastBackupAt: T0.toISOString() });
  const s2 = await getSettings(db);
  assert.equal(s2.lastBackupAt, T0.toISOString());
  assert.equal(s2.stages.length, 7);
});

test('企業: 登録すると全項目（後フェーズ分を含む）と正規化キーを持つ', async () => {
  const db = await freshDB();
  const c = await saveCompany(db, { ...SAMPLE_COMPANY, name: 'ｻﾝﾌﾟﾙ商事' }, { now: T0 });
  assert.ok(c.id);
  assert.equal(c.nameKey, 'サンプル商事');
  assert.deepEqual(c.financials, []);
  assert.deepEqual(c.sources, []);
  assert.deepEqual(c.scores, {});
  for (const k of ['strengths', 'weaknesses', 'competitors']) assert.equal(c[k], '');
  assert.equal(c.createdAt, T0.toISOString());
  assert.deepEqual(await getCompany(db, c.id), c);
});

test('企業: 更新すると入力項目だけが変わり、他の項目と createdAt は保持される', async () => {
  const db = await freshDB();
  const c = await saveCompany(db, SAMPLE_COMPANY, { now: T0 });
  // 後フェーズで入力する項目を直接書き込んでおく
  await run(db, ['companies'], 'readwrite', (tx) => put(tx, 'companies', { ...c, scores: { salary: 4 } }));
  const later = new Date('2026-10-02T00:00:00.000Z');
  const u = await saveCompany(db, { ...SAMPLE_COMPANY, id: c.id, name: '架空物産', interestLevel: '5' }, { now: later });
  assert.equal(u.name, '架空物産');
  assert.equal(u.nameKey, '架空物産');
  assert.equal(u.interestLevel, 5);
  assert.deepEqual(u.scores, { salary: 4 });
  assert.equal(u.createdAt, T0.toISOString());
  assert.equal(u.updatedAt, later.toISOString());
});

test('企業: 入力エラーは保存しない', async () => {
  const db = await freshDB();
  await assert.rejects(saveCompany(db, { name: '' }), (e) => e.name === 'ValidationError' && !!e.errors.name);
  await assert.rejects(saveCompany(db, { name: 'x', id: 'missing' }), /見つかりません/);
  assert.equal((await listCompanies(db)).length, 0);
});

/** 企業2社に応募・イベント・タスク・面接記録・担当者を用意する */
async function seed() {
  const db = await freshDB();
  const a = await saveCompany(db, { name: '架空商事A' }, { now: T0 });
  const b = await saveCompany(db, { name: '架空商事B' }, { now: T0 });
  const appA1 = (await createApplication(db, { companyId: a.id, position: '職種1' }, { now: T0 })).application;
  const appA2 = (await createApplication(db, { companyId: a.id, position: '職種2', appliedAt: '2026-10-01' }, { now: T0 })).application;
  const appB = (await createApplication(db, { companyId: b.id, position: '職種3' }, { now: T0 })).application;
  await changeStatus(db, appA1.id, { stage: 'first', state: 'planned' }, { now: new Date('2026-10-02') });
  await run(db, ['tasks', 'interviews', 'contacts'], 'readwrite', async (tx) => {
    await put(tx, 'tasks', { id: 't1', title: '応募A1のタスク', applicationId: appA1.id, companyId: a.id, done: 0 });
    await put(tx, 'tasks', { id: 't2', title: '企業Aだけに紐づくタスク', applicationId: null, companyId: a.id, done: 0 });
    await put(tx, 'tasks', { id: 't3', title: '応募Bのタスク', applicationId: appB.id, companyId: b.id, done: 0 });
    await put(tx, 'tasks', { id: 't4', title: '紐づけなし', applicationId: null, companyId: null, done: 0 });
    await put(tx, 'interviews', { id: 'i1', applicationId: appA1.id, eventId: 'e' });
    await put(tx, 'interviews', { id: 'i2', applicationId: appB.id, eventId: 'e' });
    await put(tx, 'contacts', { id: 'p1', name: '架空 太郎', companyId: a.id });
    await put(tx, 'contacts', { id: 'p2', name: '架空 花子', companyId: b.id });
  });
  return { db, a, b, appA1, appA2, appB };
}

async function dump(db) {
  const stores = ['companies', 'applications', 'events', 'tasks', 'interviews', 'contacts'];
  return run(db, stores, 'readonly', async (tx) => {
    const out = {};
    for (const s of stores) out[s] = (await getAll(tx, s)).sort((x, y) => (x.id < y.id ? -1 : 1));
    return out;
  });
}

test('応募: 企業ごとの一覧と、イベント履歴', async () => {
  const { db, a, appA1 } = await seed();
  assert.equal((await listApplicationsByCompany(db, a.id)).length, 2);
  const events = await listEventsByApplication(db, appA1.id);
  assert.deepEqual(events.map((e) => e.stage), ['preparing', 'first']);
});

test('企業の削除: 件数の事前確認', async () => {
  const { db, a } = await seed();
  assert.deepEqual(await countCompanyCascade(db, a.id), {
    applications: 2, events: 3, tasks: 2, interviews: 1, contacts: 1,
  });
});

test('企業の削除: 紐づく応募・イベント・タスク・面接記録が消え、他社のデータは残る', async () => {
  const { db, a, b, appB } = await seed();
  await deleteCompany(db, a.id);
  const d = await dump(db);
  assert.deepEqual(d.companies.map((c) => c.id), [b.id]);
  assert.deepEqual(d.applications.map((x) => x.id), [appB.id]);
  assert.ok(d.events.every((e) => e.applicationId === appB.id));
  assert.deepEqual(d.tasks.map((t) => t.id), ['t3', 't4']);
  assert.deepEqual(d.interviews.map((i) => i.id), ['i2']);
  // 担当者は削除せず、紐づけだけ外す
  assert.deepEqual(d.contacts.map((p) => [p.id, p.companyId]), [['p1', null], ['p2', b.id]]);
});

test('企業の削除: 元に戻すと完全に元通りになる', async () => {
  const { db, a } = await seed();
  const before = await dump(db);
  const snapshot = await deleteCompany(db, a.id);
  await restoreSnapshot(db, snapshot);
  assert.deepEqual(await dump(db), before);
});

test('企業の削除: 存在しない企業はエラー', async () => {
  const { db } = await seed();
  await assert.rejects(deleteCompany(db, 'missing'), /見つかりません/);
});

test('応募の削除: 紐づくイベント・タスク・面接記録が消え、元に戻せる', async () => {
  const { db, a, appA1 } = await seed();
  const before = await dump(db);
  assert.deepEqual(await countApplicationCascade(db, appA1.id), { events: 2, tasks: 1, interviews: 1 });
  const snapshot = await deleteApplication(db, appA1.id);
  assert.equal(await getApplication(db, appA1.id), undefined);
  assert.equal((await listEventsByApplication(db, appA1.id)).length, 0);
  const d = await dump(db);
  assert.deepEqual(d.tasks.map((t) => t.id), ['t2', 't3', 't4']);
  assert.deepEqual(d.interviews.map((i) => i.id), ['i2']);
  assert.ok(await getCompany(db, a.id));
  await restoreSnapshot(db, snapshot);
  assert.deepEqual(await dump(db), before);
});

test('summarizeHome: 進行中の件数と直近の予定', () => {
  const now = new Date('2026-10-10T00:00:00.000Z');
  const companies = [{ id: 'c1', name: '架空商事' }];
  const applications = [
    { id: 'a1', companyId: 'c1', stage: 'first', state: 'planned' },
    { id: 'a2', companyId: 'c1', stage: 'document', state: 'failed' },
    { id: 'a3', companyId: 'c1', stage: 'offer', state: 'waiting' },
    { id: 'a4', companyId: 'c1', stage: 'offer', state: 'accepted' },
    { id: 'a5', companyId: 'c1', stage: 'second', state: 'planned' },
  ];
  const events = [
    // a1: 古い予定は最新イベントで上書きされている
    { id: 'e1', applicationId: 'a1', scheduledAt: '2026-10-12T01:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' },
    { id: 'e2', applicationId: 'a1', scheduledAt: '2026-10-15T01:00:00.000Z', createdAt: '2026-10-02T00:00:00.000Z' },
    { id: 'e3', applicationId: 'a2', scheduledAt: '2026-10-11T01:00:00.000Z', createdAt: '2026-10-02T00:00:00.000Z' },
    { id: 'e4', applicationId: 'a5', scheduledAt: '2026-10-11T01:00:00.000Z', createdAt: '2026-10-02T00:00:00.000Z' },
    // 過去の予定は表示しない
    { id: 'e5', applicationId: 'a3', scheduledAt: '2026-10-01T01:00:00.000Z', createdAt: '2026-10-02T00:00:00.000Z' },
  ];
  const s = summarizeHome({ companies, applications, events }, now);
  assert.equal(s.activeCount, 3);
  assert.equal(s.offerCount, 2); // 回答前 + 承諾済み
  assert.equal(s.closedCount, 1);
  assert.deepEqual(s.upcoming.map((u) => u.event.id), ['e4', 'e2']);
  assert.equal(s.upcoming[0].company.name, '架空商事');
});

test('summarizeHome: データが0件', () => {
  const s = summarizeHome({ companies: [], applications: [], events: [] });
  assert.deepEqual(s, { activeCount: 0, offerCount: 0, closedCount: 0, upcoming: [] });
});

test('getHomeSummary: DBから集計する', async () => {
  const { db, appA1 } = await seed();
  await changeStatus(db, appA1.id, { stage: 'first', state: 'planned', scheduledAt: '2026-10-20T10:00' }, { now: new Date('2026-10-03') });
  const s = await getHomeSummary(db, new Date('2026-10-05'));
  assert.equal(s.activeCount, 3);
  assert.deepEqual(s.upcoming.map((u) => u.application.id), [appA1.id]);
  assert.equal((await listApplications(db)).length, 3);
});
