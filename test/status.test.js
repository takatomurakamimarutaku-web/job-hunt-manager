import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getApplication, listEventsByApplication, saveCompany, saveSettings, latestEventByApplication } from '../js/db.js';
import {
  validateStatus, buildStatusChange, changeStatus, createApplication, updateApplication, updateEvent,
  isClosed, defaultInitialStatus, sortHistory,
} from '../js/status.js';
import { cloneDefaultStages, addStage } from '../js/stages.js';
import { freshDB, SAMPLE_COMPANY } from './helpers.js';

const T0 = new Date('2026-10-01T00:00:00.000Z');
const at = (min) => new Date(T0.getTime() + min * 60_000);

async function setup() {
  const db = await freshDB();
  const company = await saveCompany(db, SAMPLE_COMPANY, { now: T0 });
  const { application } = await createApplication(
    db, { companyId: company.id, position: 'エンジニア', channel: 'agent', appliedAt: '2026-10-01' }, { now: T0 }
  );
  return { db, company, application };
}

/** 現在のステータスと最新の履歴が一致していることを確認する */
async function assertConsistent(db, appId) {
  const app = await getApplication(db, appId);
  const events = await listEventsByApplication(db, appId);
  const latest = latestEventByApplication(events).get(appId);
  assert.equal(app.stage, latest.stage);
  assert.equal(app.state, latest.state);
  return { app, events };
}

test('validateStatus: offer 以外での accepted を拒否する', () => {
  const stages = cloneDefaultStages();
  assert.equal(validateStatus('offer', 'accepted', stages), null);
  assert.match(validateStatus('final', 'accepted', stages), /内定/);
  assert.match(validateStatus('document', 'accepted', stages), /内定/);
  assert.match(validateStatus('nope', 'planned', stages), /段階/);
  assert.match(validateStatus('first', 'nope', stages), /状態/);
});

test('validateStatus: 追加した段階も使える', () => {
  const stages = addStage(cloneDefaultStages(), '三次面接', 'final', () => 'x');
  assert.equal(validateStatus('custom-x', 'planned', stages), null);
});

test('isClosed: 不合格・辞退は終了、それ以外は進行中', () => {
  assert.ok(isClosed('failed'));
  assert.ok(isClosed('declined'));
  assert.ok(!isClosed('passed'));
  assert.ok(!isClosed('accepted'));
});

test('defaultInitialStatus: 応募日の有無で初期ステータスを決める', () => {
  assert.deepEqual(defaultInitialStatus('2026-10-01T00:00:00.000Z'), { stage: 'document', state: 'waiting' });
  assert.deepEqual(defaultInitialStatus(null), { stage: 'preparing', state: 'planned' });
});

test('buildStatusChange: 引数を変更せず、応募とイベントを返す', () => {
  const app = Object.freeze({ id: 'a1', companyId: 'c1', stage: 'document', state: 'waiting', updatedAt: 'x' });
  const { application, event } = buildStatusChange(
    app, { stage: 'first', state: 'planned', scheduledAt: '2026-11-01T10:00', place: '本社' },
    { stages: cloneDefaultStages(), now: T0 }
  );
  assert.equal(app.stage, 'document');
  assert.equal(application.stage, 'first');
  assert.equal(application.state, 'planned');
  assert.equal(event.applicationId, 'a1');
  assert.equal(event.place, '本社');
  assert.equal(event.scheduledAt, new Date(2026, 10, 1, 10).toISOString());
  assert.equal(application.updatedAt, event.createdAt);
});

test('buildStatusChange: 同時刻なら直前のイベントより後の時刻にして順序を保つ', () => {
  const app = { id: 'a1', stage: 'document', state: 'waiting' };
  const latestEvent = { createdAt: T0.toISOString() };
  const { event } = buildStatusChange(app, { stage: 'document', state: 'passed' }, { stages: cloneDefaultStages(), now: T0, latestEvent });
  assert.ok(event.createdAt > latestEvent.createdAt);
});

test('createApplication: 応募と最初のイベントを作り、整合している', async () => {
  const { db, application } = await setup();
  assert.equal(application.stage, 'document');
  assert.equal(application.state, 'waiting');
  const { events } = await assertConsistent(db, application.id);
  assert.equal(events.length, 1);
});

test('createApplication: 存在しない企業・不正なステータスは何も保存しない', async () => {
  const { db, company } = await setup();
  await assert.rejects(createApplication(db, { companyId: 'missing' }), /企業が見つかりません/);
  await assert.rejects(createApplication(db, { companyId: company.id, stage: 'first', state: 'accepted' }), /内定/);
  const { listApplications } = await import('../js/db.js');
  assert.equal((await listApplications(db)).length, 1);
});

test('changeStatus: 現在のステータスと履歴が整合し、履歴が時系列に積み上がる', async () => {
  const { db, application } = await setup();
  const steps = [
    ['document', 'passed'], ['first', 'planned'], ['first', 'passed'],
    ['final', 'planned'], ['final', 'passed'], ['offer', 'waiting'], ['offer', 'accepted'],
  ];
  for (const [i, [stage, state]] of steps.entries()) {
    await changeStatus(db, application.id, { stage, state }, { now: at(i + 1) });
    await assertConsistent(db, application.id);
  }
  const { app, events } = await assertConsistent(db, application.id);
  assert.equal(events.length, steps.length + 1);
  assert.deepEqual(sortHistory(events).slice(1).map((e) => [e.stage, e.state]), steps);
  assert.equal(app.state, 'accepted');
});

test('changeStatus: 同じ時刻に連続で変更しても順序が崩れない', async () => {
  const { db, application } = await setup();
  await changeStatus(db, application.id, { stage: 'document', state: 'passed' }, { now: T0 });
  await changeStatus(db, application.id, { stage: 'first', state: 'planned' }, { now: T0 });
  const { app } = await assertConsistent(db, application.id);
  assert.equal(app.stage, 'first');
});

test('changeStatus: offer 以外の accepted は拒否し、応募もイベントも変わらない', async () => {
  const { db, application } = await setup();
  await assert.rejects(
    changeStatus(db, application.id, { stage: 'final', state: 'accepted' }, { now: at(1) }),
    (err) => err.name === 'ValidationError' && /内定/.test(err.message)
  );
  const { app, events } = await assertConsistent(db, application.id);
  assert.equal(app.stage, 'document');
  assert.equal(app.state, 'waiting');
  assert.equal(events.length, 1);
});

test('changeStatus: 日時の検証エラーでも何も書き込まない', async () => {
  const { db, application } = await setup();
  await assert.rejects(changeStatus(db, application.id, {
    stage: 'first', state: 'planned', scheduledAt: '2026-11-01T10:00', endAt: '2026-11-01T09:00',
  }));
  const { events } = await assertConsistent(db, application.id);
  assert.equal(events.length, 1);
});

test('changeStatus: 存在しない応募はエラー', async () => {
  const { db } = await setup();
  await assert.rejects(changeStatus(db, 'missing', { stage: 'first', state: 'planned' }), /応募が見つかりません/);
});

test('changeStatus: 終了判定（不合格・辞退で終了、再開もできる）', async () => {
  const { db, application } = await setup();
  await changeStatus(db, application.id, { stage: 'document', state: 'failed' }, { now: at(1) });
  assert.ok(isClosed((await getApplication(db, application.id)).state));
  await changeStatus(db, application.id, { stage: 'first', state: 'declined' }, { now: at(2) });
  assert.ok(isClosed((await getApplication(db, application.id)).state));
  await changeStatus(db, application.id, { stage: 'first', state: 'planned' }, { now: at(3) });
  assert.ok(!isClosed((await getApplication(db, application.id)).state));
});

test('changeStatus: 設定画面で追加した段階を使える', async () => {
  const { db, application } = await setup();
  await saveSettings(db, { stages: addStage(cloneDefaultStages(), '三次面接', 'second', () => 'x') });
  await changeStatus(db, application.id, { stage: 'custom-x', state: 'planned' }, { now: at(1) });
  const { app } = await assertConsistent(db, application.id);
  assert.equal(app.stage, 'custom-x');
});

test('updateApplication: 基本情報は更新できるが stage / state は変わらない', async () => {
  const { db, application } = await setup();
  const next = await updateApplication(db, application.id, {
    position: 'PM', channel: 'direct', appliedAt: '2026-10-02', stage: 'offer', state: 'accepted', companyId: 'other',
  });
  assert.equal(next.position, 'PM');
  assert.equal(next.stage, 'document');
  assert.equal(next.state, 'waiting');
  assert.equal(next.companyId, application.companyId);
  await assertConsistent(db, application.id);
});

test('updateEvent: 日時・場所を修正してもステータスは変わらない', async () => {
  const { db, application } = await setup();
  const { event } = await changeStatus(db, application.id, { stage: 'first', state: 'planned', scheduledAt: '2026-11-01T10:00' }, { now: at(1) });
  const next = await updateEvent(db, event.id, { scheduledAt: '2026-11-02T14:00', place: 'オンライン', onlineUrl: 'https://example.com/meet' });
  assert.equal(next.scheduledAt, new Date(2026, 10, 2, 14).toISOString());
  assert.equal(next.place, 'オンライン');
  assert.equal(next.stage, 'first');
  await assert.rejects(updateEvent(db, event.id, { onlineUrl: 'javascript:alert(1)' }), /URL/);
  await assertConsistent(db, application.id);
});
