// 選考ステータスの変更と履歴
// ステータスの変更は必ず changeStatus() を経由する。応募の現在のステータスの更新と
// 選考イベント（履歴）の追加を1つのトランザクションで行い、不整合を防ぐ。

import { get, getAllByIndex, put, readSettings, run, newApplication, newEvent, latestEventByApplication } from './db.js';
import { STATES, OFFER_STAGE_ID, findStage, isClosed } from './stages.js';
import { validateApplication, validateEventInput, ValidationError } from './validate.js';

export { isClosed };

/** 段階と状態の組み合わせを検証する。問題があればメッセージ、なければ null */
export function validateStatus(stageId, state, stages) {
  if (!findStage(stages, stageId)) return '段階が正しくありません';
  if (!STATES.includes(state)) return '状態が正しくありません';
  if (state === 'accepted' && stageId !== OFFER_STAGE_ID) return '「承諾」は内定の段階でのみ選択できます';
  return null;
}

/** 新規応募の初期ステータス：応募日があれば書類選考・結果待ち、なければ応募準備・予定 */
export function defaultInitialStatus(appliedAt) {
  return appliedAt ? { stage: 'document', state: 'waiting' } : { stage: 'preparing', state: 'planned' };
}

/** 履歴を時系列（古い順）に並べる */
export function sortHistory(events) {
  return [...events].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/**
 * ステータス変更の内容を組み立てる（純粋関数。引数は変更しない）
 * @param {object} app 現在の応募
 * @param {object} input { stage, state, scheduledAt, endAt, place, onlineUrl, memo }
 * @param {object} ctx { stages, now, latestEvent }
 * @returns {{ application: object, event: object }}
 * @throws {ValidationError}
 */
export function buildStatusChange(app, input, { stages, now = new Date(), latestEvent = null }) {
  const errors = {};
  const statusError = validateStatus(input.stage, input.state, stages);
  if (statusError) errors.status = statusError;
  const ev = validateEventInput(input);
  Object.assign(errors, ev.errors);
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  // 履歴の順序を確定させるため、同じ時刻になった場合は直前のイベントより1ミリ秒後にする
  let t = new Date(now).getTime();
  if (latestEvent && t <= Date.parse(latestEvent.createdAt)) t = Date.parse(latestEvent.createdAt) + 1;
  const createdAt = new Date(t).toISOString();

  const application = { ...app, stage: input.stage, state: input.state, updatedAt: createdAt };
  const event = newEvent({ applicationId: app.id, stage: input.stage, state: input.state, ...ev.value }, createdAt);
  return { application, event };
}

/**
 * ステータスを変更する。応募の更新とイベントの追加を1トランザクションで行う。
 * 検証エラー時は何も書き込まない。
 */
export function changeStatus(db, applicationId, input, { now = new Date() } = {}) {
  return run(db, ['applications', 'events', 'settings'], 'readwrite', async (tx) => {
    const app = await get(tx, 'applications', applicationId);
    if (!app) throw new Error('応募が見つかりません');
    const settings = await readSettings(tx);
    const events = await getAllByIndex(tx, 'events', 'applicationId', applicationId);
    const latestEvent = latestEventByApplication(events).get(applicationId) || null;
    const result = buildStatusChange(app, input, { stages: settings.stages, now, latestEvent });
    await put(tx, 'applications', result.application);
    await put(tx, 'events', result.event);
    return result;
  });
}

/**
 * 応募を登録する。最初の選考イベントも同じトランザクションで作成し、
 * 「最新のイベント = 現在のステータス」が常に成り立つようにする。
 * @param {object} input { companyId, position, channel, appliedAt, memo, stage?, state?, scheduledAt?, ... }
 */
export function createApplication(db, input, { now = new Date() } = {}) {
  const base = validateApplication(input);
  const initial = input.stage ? { stage: input.stage, state: input.state } : defaultInitialStatus(base.value.appliedAt);
  return run(db, ['companies', 'applications', 'events', 'settings'], 'readwrite', async (tx) => {
    if (!base.ok) throw new ValidationError(base.errors);
    const company = await get(tx, 'companies', base.value.companyId);
    if (!company) throw new ValidationError({ companyId: '企業が見つかりません' });
    const settings = await readSettings(tx);
    const t = new Date(now).toISOString();
    const draft = newApplication({ ...base.value, createdAt: t, updatedAt: t }, now);
    const { application, event } = buildStatusChange(draft, { ...input, ...initial }, { stages: settings.stages, now });
    await put(tx, 'applications', application);
    await put(tx, 'events', event);
    return { application, event };
  });
}

/**
 * 応募の基本情報（職種・応募経路・応募日・メモ）を更新する。
 * stage / state はここでは変更できない（changeStatus 以外の経路を塞ぐ）。
 */
export function updateApplication(db, applicationId, input, { now = new Date() } = {}) {
  return run(db, ['applications'], 'readwrite', async (tx) => {
    const app = await get(tx, 'applications', applicationId);
    if (!app) throw new Error('応募が見つかりません');
    const { ok, errors, value } = validateApplication({ ...input, companyId: app.companyId });
    if (!ok) throw new ValidationError(errors);
    const next = { ...app, ...value, companyId: app.companyId, updatedAt: new Date(now).toISOString() };
    await put(tx, 'applications', next);
    return next;
  });
}

/**
 * 既存の選考イベントの日時・場所・URL・メモを修正する（ステータスは変えない）。
 * Phase 3 でタスク期日の再計算の入り口になる。
 */
export function updateEvent(db, eventId, patch) {
  return run(db, ['events'], 'readwrite', async (tx) => {
    const ev = await get(tx, 'events', eventId);
    if (!ev) throw new Error('選考イベントが見つかりません');
    const fields = ['scheduledAt', 'endAt', 'place', 'onlineUrl', 'memo'];
    const merged = Object.fromEntries(fields.map((f) => [f, f in patch ? patch[f] : ev[f]]));
    const { ok, errors, value } = validateEventInput(merged);
    if (!ok) throw new ValidationError(errors);
    const next = { ...ev, ...value };
    await put(tx, 'events', next);
    return next;
  });
}
