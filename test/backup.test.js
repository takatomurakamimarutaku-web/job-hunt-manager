import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, put, getAll, STORES, saveCompany, saveSettings, getSettings, countAll } from '../js/db.js';
import { createApplication, changeStatus } from '../js/status.js';
import { addStage, cloneDefaultStages } from '../js/stages.js';
import { MIN_ITERATIONS } from '../js/crypto.js';
import {
  collectBackup, createBackupFile, readBackupFile, importBackup, validateBackup, upgradeBackup,
  needsBackupReminder, validatePassword, mergeStages, markBackedUp, summarizeBackup, backupFileName,
  BackupError, BACKUP_VERSION,
} from '../js/backup.js';
import { freshDB, SAMPLE_COMPANY } from './helpers.js';

const T0 = new Date('2026-10-01T00:00:00.000Z');
const FAST = MIN_ITERATIONS;
const isCode = (code) => (err) => err instanceof BackupError && err.code === code;
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00, 0xff, 0x80]);

/** 全ストアにデータを入れた DB（添付ファイル・追加した段階を含む） */
async function seeded() {
  const db = await freshDB();
  const c = await saveCompany(db, SAMPLE_COMPANY, { now: T0 });
  await saveSettings(db, { stages: addStage(cloneDefaultStages(), '三次面接', 'final', () => 'x') });
  const { application } = await createApplication(db, { companyId: c.id, position: '架空エンジニア', appliedAt: '2026-10-01' }, { now: T0 });
  await changeStatus(db, application.id, { stage: 'custom-x', state: 'planned', scheduledAt: '2026-11-01T10:00' }, { now: new Date('2026-10-02') });
  await run(db, ['tasks', 'taskTemplates', 'interviews', 'questions', 'documents', 'files', 'contacts'], 'readwrite', async (tx) => {
    await put(tx, 'tasks', { id: 't1', title: '架空のタスク', dueAt: '2026-10-05T00:00:00.000Z', done: 0, applicationId: application.id, companyId: c.id, updatedAt: '2026-10-01T00:00:00.000Z' });
    await put(tx, 'taskTemplates', { id: 'tt1', trigger: { stage: 'first', state: 'planned' }, items: [{ title: '企業研究', offsetDays: -3, base: 'event' }] });
    await put(tx, 'interviews', { id: 'i1', applicationId: application.id, eventId: 'e', questions: [], updatedAt: '2026-10-01T00:00:00.000Z' });
    await put(tx, 'questions', { id: 'q1', text: 'じこしょうかい', textKey: 'ジコショウカイ', category: 'other', updatedAt: '2026-10-01T00:00:00.000Z' });
    await put(tx, 'documents', { id: 'd1', type: 'motivation', title: '志望動機', body: '架空の本文', version: 1, parentId: null, fileId: 'f1', updatedAt: '2026-10-01T00:00:00.000Z' });
    await put(tx, 'files', { id: 'f1', name: 'resume.pdf', mimeType: 'application/pdf', blob: new Blob([PDF_BYTES], { type: 'application/pdf' }) });
    await put(tx, 'contacts', { id: 'p1', name: '架空 太郎', nameKey: '架空 太郎', companyId: c.id, logs: [{ date: '2026-10-01', memo: '面談' }], updatedAt: '2026-10-01T00:00:00.000Z' });
  });
  return { db, company: c, application };
}

/** 比較用に全ストアを取り出す（Blob はバイト列に変換） */
async function dumpAll(db) {
  const raw = await run(db, STORES, 'readonly', async (tx) => {
    const out = {};
    for (const s of STORES) out[s] = (await getAll(tx, s)).sort((a, b) => ((a.id || a.key) < (b.id || b.key) ? -1 : 1));
    return out;
  });
  for (const f of raw.files) {
    f.blobType = f.blob.type;
    f.blob = [...new Uint8Array(await f.blob.arrayBuffer())];
  }
  return raw;
}

test('collectBackup: 全ストアを含み、添付ファイルは Base64 になる', async () => {
  const { db } = await seeded();
  const data = await collectBackup(db, { now: T0, appVersion: 'vX' });
  assert.equal(data.format, 'job-hunt-backup');
  assert.equal(data.version, BACKUP_VERSION);
  assert.equal(data.appVersion, 'vX');
  assert.deepEqual(Object.keys(data.stores).sort(), [...STORES].sort());
  assert.equal(typeof data.stores.files[0].data, 'string');
  assert.equal(data.stores.files[0].blob, undefined);
  assert.deepEqual(summarizeBackup(data), {
    companies: 1, applications: 1, events: 2, tasks: 1, taskTemplates: 1, interviews: 1, questions: 1, documents: 1, files: 1, contacts: 1,
  });
});

test('暗号化エクスポート→インポート（置き換え）で全データが一致する（添付ファイルを含む）', async () => {
  const { db } = await seeded();
  const before = await dumpAll(db);
  const file = await createBackupFile(db, { password: 'password-123', now: T0, iterations: FAST });
  assert.match(file.fileName, /^job-hunt-backup-\d{8}-\d{4}\.jhbak$/);

  const target = await freshDB();
  await saveCompany(target, { name: '消えるはずの架空企業' });
  const data = await readBackupFile(file.bytes, 'password-123');
  const result = await importBackup(target, data, { mode: 'replace' });
  assert.equal(result.deleted, 1); // 置き換え前にあった企業1件
  const after = await dumpAll(target);
  // 置き換え後の最終バックアップ日時はバックアップの作成日時になる
  assert.equal(after.settings[0].lastBackupAt, T0.toISOString());
  after.settings[0].lastBackupAt = before.settings[0].lastBackupAt;
  assert.deepEqual(after, before);
  assert.deepEqual(after.files[0].blob, [...PDF_BYTES]);
  assert.equal(after.files[0].blobType, 'application/pdf');
});

test('暗号化なしのエクスポート→インポートでも一致する', async () => {
  const { db } = await seeded();
  const before = await dumpAll(db);
  const file = await createBackupFile(db, { encrypted: false, now: T0 });
  assert.match(file.fileName, /\.json$/);
  assert.equal(JSON.parse(new TextDecoder().decode(file.bytes)).format, 'job-hunt-backup');
  const target = await freshDB();
  await importBackup(target, await readBackupFile(file.bytes), { mode: 'replace' });
  const after = await dumpAll(target);
  after.settings[0].lastBackupAt = before.settings[0].lastBackupAt;
  assert.deepEqual(after, before);
});

test('誤ったパスワード・パスワードなしでは読み込めない', async () => {
  const { db } = await seeded();
  const file = await createBackupFile(db, { password: 'password-123', iterations: FAST });
  await assert.rejects(readBackupFile(file.bytes, 'password-999'), isCode('wrong-password'));
  await assert.rejects(readBackupFile(file.bytes, ''), isCode('need-password'));
});

test('短いパスワードではエクスポートしない', async () => {
  const { db } = await seeded();
  await assert.rejects(createBackupFile(db, { password: 'short' }), isCode('weak-password'));
  assert.match(validatePassword('', ''), /入力/);
  assert.match(validatePassword('1234567', '1234567'), /8文字/);
  assert.match(validatePassword('12345678', '12345679'), /一致/);
  assert.equal(validatePassword('12345678', '12345678'), null);
});

test('インポート時に正規化キーを作り直す', async () => {
  const { db } = await seeded();
  const data = await collectBackup(db);
  data.stores.questions[0].textKey = '';
  data.stores.contacts[0].nameKey = '古いキー';
  const target = await freshDB();
  await importBackup(target, data, { mode: 'replace' });
  const d = await dumpAll(target);
  assert.equal(d.questions[0].textKey, 'ジコショウカイ');
  assert.equal(d.contacts[0].nameKey, '架空 太郎');
});

test('追加モード：新しい方を残し、二度取り込んでも重複しない', async () => {
  const { db, company } = await seeded();
  const data = await collectBackup(db);
  // 端末側で企業を更新（バックアップより新しい）し、別の企業も追加する
  await saveCompany(db, { ...SAMPLE_COMPANY, id: company.id, memo: '端末で更新' }, { now: new Date('2026-12-01') });
  await saveCompany(db, { name: '端末だけの架空企業' });
  // バックアップ側には、端末にない企業と、端末より新しいタスクを入れる
  data.stores.companies.push({ ...data.stores.companies[0], id: 'only-in-backup', name: 'バックアップだけの架空企業' });
  data.stores.tasks[0] = { ...data.stores.tasks[0], title: 'バックアップで更新', updatedAt: '2027-01-01T00:00:00.000Z' };

  const r1 = await importBackup(db, data, { mode: 'merge' });
  assert.equal(r1.added, 1);
  assert.equal(r1.updated, 1);
  const d = await dumpAll(db);
  assert.equal(d.companies.length, 3);
  assert.equal(d.companies.find((c) => c.id === company.id).memo, '端末で更新');
  assert.equal(d.tasks[0].title, 'バックアップで更新');

  const r2 = await importBackup(db, data, { mode: 'merge' });
  assert.equal(r2.added, 0);
  assert.equal(r2.updated, 0);
  assert.equal((await countAll(db)).companies, 3);
});

test('追加モード：設定は端末側を残し、足りない段階だけ追加する', async () => {
  const { db } = await seeded();
  const data = await collectBackup(db);
  const target = await freshDB();
  await saveSettings(target, { lastBackupAt: '2026-09-01T00:00:00.000Z' });
  await importBackup(target, data, { mode: 'merge' });
  const s = await getSettings(target);
  assert.equal(s.lastBackupAt, '2026-09-01T00:00:00.000Z');
  assert.deepEqual(s.stages.map((x) => x.id), ['interest', 'preparing', 'document', 'first', 'second', 'final', 'custom-x', 'offer']);
});

test('mergeStages: 同じ段階は重複させず、内定の直前に追加する', () => {
  const current = cloneDefaultStages();
  const imported = addStage(addStage(cloneDefaultStages(), 'A', 'interest', () => 'a'), 'B', null, () => 'b');
  const merged = mergeStages(current, imported);
  assert.deepEqual(merged.map((s) => s.id).slice(-3), ['custom-a', 'custom-b', 'offer']);
  assert.deepEqual(merged.map((s) => s.order), merged.map((_, i) => i));
  assert.equal(mergeStages(current, current).length, 7);
});

test('不正なファイル：JSON でない・format 違い・stores 欠落・ID なし・ID 重複で、DB は変わらない', async () => {
  const { db } = await seeded();
  const before = await dumpAll(db);
  const good = await collectBackup(db);
  const enc = (o) => new TextEncoder().encode(typeof o === 'string' ? o : JSON.stringify(o));
  await assert.rejects(readBackupFile(enc('これはJSONではない')), isCode('not-backup'));
  await assert.rejects(readBackupFile(enc({ format: 'other-app', version: 1 })), isCode('not-backup'));
  await assert.rejects(readBackupFile(enc({ ...good, version: 'x' })), isCode('corrupted'));
  const noStore = structuredClone(good);
  delete noStore.stores.events;
  await assert.rejects(readBackupFile(enc(noStore)), (e) => isCode('corrupted')(e) && /選考イベント/.test(e.message));
  const noId = structuredClone(good);
  delete noId.stores.companies[0].id;
  await assert.rejects(readBackupFile(enc(noId)), isCode('corrupted'));
  const dup = structuredClone(good);
  dup.stores.tasks.push({ ...dup.stores.tasks[0] });
  await assert.rejects(readBackupFile(enc(dup)), isCode('corrupted'));
  const badFile = structuredClone(good);
  delete badFile.stores.files[0].data;
  assert.throws(() => validateBackup(badFile), isCode('corrupted'));
  await assert.rejects(importBackup(db, badFile, { mode: 'replace' }), isCode('corrupted'));
  assert.deepEqual(await dumpAll(db), before);
});

test('取り込み途中の失敗では何も変わらない（置き換えでも元のデータが残る）', async () => {
  const { db } = await seeded();
  const before = await dumpAll(db);
  const data = await collectBackup(db);
  // 保存できない値（関数）を含めて、書き込みの途中で失敗させる
  data.stores.tasks.push({ id: 't-bad', title: 'x', bad: () => {} });
  await assert.rejects(importBackup(db, data, { mode: 'replace' }));
  assert.deepEqual(await dumpAll(db), before);
});

test('新しいバージョンのファイルは拒否する', async () => {
  const { db } = await seeded();
  const data = await collectBackup(db);
  const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
  await assert.rejects(readBackupFile(enc({ ...data, version: BACKUP_VERSION + 1 })), isCode('too-new'));
  await assert.rejects(readBackupFile(enc({ ...data, schemaVersion: 99 })), isCode('too-new'));
});

test('旧バージョンのファイルは変換してから取り込む', async () => {
  const { db } = await seeded();
  const current = await collectBackup(db);
  // 仮の「v1 → v2」変換：v2 で全企業に新しい項目が増えたと想定する
  const migrations = { 1: (d) => ({ ...d, version: 2, stores: { ...d.stores, companies: d.stores.companies.map((c) => ({ ...c, newField: '既定値' })) } }) };
  const upgraded = upgradeBackup(current, { targetVersion: 2, migrations });
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.stores.companies[0].newField, '既定値');
  assert.equal(current.version, 1); // 元のデータは変更しない
  const bytes = new TextEncoder().encode(JSON.stringify(current));
  const read = await readBackupFile(bytes, '', { targetVersion: 2, migrations });
  assert.equal(read.stores.companies[0].newField, '既定値');
  // 変換関数が無いバージョンは「対応していません」
  assert.throws(() => upgradeBackup(current, { targetVersion: 3, migrations }), isCode('unsupported'));
});

test('markBackedUp: 最終バックアップ日時を記録する', async () => {
  const db = await freshDB();
  await markBackedUp(db, T0);
  assert.equal((await getSettings(db)).lastBackupAt, T0.toISOString());
});

test('needsBackupReminder: データ0件・未実施・13日・14日', () => {
  const now = new Date('2026-10-15T00:00:00.000Z');
  assert.equal(needsBackupReminder(null, false, now), false);
  assert.equal(needsBackupReminder(null, true, now), true);
  assert.equal(needsBackupReminder('2026-10-02T00:00:01.000Z', true, now), false); // 13日と少し
  assert.equal(needsBackupReminder('2026-10-01T00:00:00.000Z', true, now), true); // ちょうど14日
  assert.equal(needsBackupReminder('2026-09-01T00:00:00.000Z', false, now), false);
});

test('backupFileName: 日時入りのファイル名', () => {
  const d = new Date(2026, 9, 5, 9, 7);
  assert.equal(backupFileName(d, true), 'job-hunt-backup-20261005-0907.jhbak');
  assert.equal(backupFileName(d, false), 'job-hunt-backup-20261005-0907.json');
});
