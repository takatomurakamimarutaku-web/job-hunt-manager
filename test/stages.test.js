import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STAGES, cloneDefaultStages, addStage, renameStage, moveStage, removeStage, sortStages, isClosed,
} from '../js/stages.js';

const ids = (stages) => sortStages(stages).map((s) => s.id);
let n = 0;
const genId = () => `t${++n}`;

test('既定の段階は7つで内定が最後', () => {
  assert.equal(DEFAULT_STAGES.length, 7);
  assert.equal(ids(DEFAULT_STAGES).at(-1), 'offer');
});

test('addStage: 既定では内定の直前に追加し、order を振り直す', () => {
  const next = addStage(cloneDefaultStages(), '三次面接', null, genId);
  const list = ids(next);
  assert.equal(list.at(-2).startsWith('custom-'), true);
  assert.equal(list.at(-1), 'offer');
  assert.deepEqual(next.map((s) => s.order), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('addStage: 指定した段階の直後に追加する', () => {
  const next = addStage(cloneDefaultStages(), 'カジュアル面談', 'interest', genId);
  assert.equal(ids(next)[1].startsWith('custom-'), true);
});

test('addStage: 空・長すぎる・重複する名称は拒否', () => {
  assert.throws(() => addStage(cloneDefaultStages(), ' '), /名称/);
  assert.throws(() => addStage(cloneDefaultStages(), 'あ'.repeat(21)), /20文字/);
  assert.throws(() => addStage(cloneDefaultStages(), '一次面接'), /同じ名称/);
});

test('renameStage: 名称だけを変え、id は変わらない', () => {
  const next = renameStage(cloneDefaultStages(), 'first', '1次面接');
  const s = next.find((x) => x.id === 'first');
  assert.equal(s.label, '1次面接');
  assert.throws(() => renameStage(cloneDefaultStages(), 'first', '二次面接'), /同じ名称/);
});

test('moveStage: 上下に入れ替える。端では変化しない', () => {
  assert.deepEqual(ids(moveStage(cloneDefaultStages(), 'second', -1)).slice(3, 5), ['second', 'first']);
  assert.deepEqual(ids(moveStage(cloneDefaultStages(), 'interest', -1)), ids(DEFAULT_STAGES));
  assert.deepEqual(ids(moveStage(cloneDefaultStages(), 'offer', 1)), ids(DEFAULT_STAGES));
});

test('removeStage: 既定の段階・使用中の段階は削除できない', () => {
  const added = addStage(cloneDefaultStages(), '三次面接', null, genId);
  const customId = ids(added).find((id) => id.startsWith('custom-'));
  assert.throws(() => removeStage(added, 'offer'), /既定/);
  assert.throws(() => removeStage(added, customId, [customId]), /使用している/);
  assert.deepEqual(ids(removeStage(added, customId)), ids(DEFAULT_STAGES));
});

test('元の配列を変更しない', () => {
  const stages = cloneDefaultStages();
  const before = JSON.stringify(stages);
  addStage(stages, '三次面接', null, genId);
  renameStage(stages, 'first', 'x');
  moveStage(stages, 'first', 1);
  assert.equal(JSON.stringify(stages), before);
});

test('isClosed: 不合格・辞退のみ終了', () => {
  assert.equal(isClosed('failed'), true);
  assert.equal(isClosed('declined'), true);
  for (const s of ['planned', 'waiting', 'passed', 'accepted']) assert.equal(isClosed(s), false);
});
