// 選考の段階（stage）マスタ・状態（state）・選択肢の定数と、段階マスタの編集（純粋関数）

/** 既定の段階。id は固定で、名称変更・並べ替えはできるが削除はできない */
export const DEFAULT_STAGES = Object.freeze([
  { id: 'interest', label: '興味あり', order: 0 },
  { id: 'preparing', label: '応募準備', order: 1 },
  { id: 'document', label: '書類選考', order: 2 },
  { id: 'first', label: '一次面接', order: 3 },
  { id: 'second', label: '二次面接', order: 4 },
  { id: 'final', label: '最終面接', order: 5 },
  { id: 'offer', label: '内定', order: 6 },
].map((s) => Object.freeze(s)));

export const BUILTIN_STAGE_IDS = Object.freeze(DEFAULT_STAGES.map((s) => s.id));
export const OFFER_STAGE_ID = 'offer';

export const STATES = Object.freeze(['planned', 'waiting', 'passed', 'failed', 'declined', 'accepted']);
export const STATE_LABELS = Object.freeze({
  planned: '予定',
  waiting: '結果待ち',
  passed: '通過',
  failed: '不合格',
  declined: '辞退',
  accepted: '承諾',
});
/** 応募が「終了」になる状態 */
export const CLOSED_STATES = Object.freeze(['failed', 'declined']);

/** 不合格・辞退なら「終了」（アーカイブ扱い） */
export function isClosed(state) {
  return CLOSED_STATES.includes(state);
}

export const CHANNELS = Object.freeze(['direct', 'agent', 'referral', 'scout', 'other']);
export const CHANNEL_LABELS = Object.freeze({
  direct: '直接応募',
  agent: 'エージェント',
  referral: 'リファラル',
  scout: 'スカウト',
  other: 'その他',
});

export const LISTINGS = Object.freeze(['', 'プライム', 'スタンダード', 'グロース', 'その他上場', '非上場', '外資系']);

export const STAGE_LABEL_MAX = 20;

export function cloneDefaultStages() {
  return DEFAULT_STAGES.map((s) => ({ ...s }));
}

/** order 順に並べ、order を 0 からの連番に振り直した新しい配列を返す */
export function sortStages(stages) {
  return [...stages]
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({ ...s, order: i }));
}

export function findStage(stages, id) {
  return stages.find((s) => s.id === id) || null;
}

export function stageLabel(stages, id) {
  const s = findStage(stages, id);
  return s ? s.label : id;
}

function checkLabel(label) {
  const v = String(label ?? '').trim();
  if (!v) throw new Error('段階の名称を入力してください');
  if (v.length > STAGE_LABEL_MAX) throw new Error(`段階の名称は${STAGE_LABEL_MAX}文字以内にしてください`);
  return v;
}

/**
 * 段階を追加する。afterId を指定するとその直後、省略すると「内定」の直前に入れる
 * @param {() => string} genId テスト用にID生成を差し替えられるようにする
 */
export function addStage(stages, label, afterId = null, genId = () => crypto.randomUUID()) {
  const name = checkLabel(label);
  if (stages.some((s) => s.label === name)) throw new Error('同じ名称の段階がすでにあります');
  const sorted = sortStages(stages);
  let index;
  if (afterId) {
    index = sorted.findIndex((s) => s.id === afterId) + 1;
    if (index === 0) throw new Error('指定した段階が見つかりません');
  } else {
    const offerIndex = sorted.findIndex((s) => s.id === OFFER_STAGE_ID);
    index = offerIndex >= 0 ? offerIndex : sorted.length;
  }
  const next = [...sorted];
  next.splice(index, 0, { id: `custom-${genId()}`, label: name, order: index });
  return next.map((s, i) => ({ ...s, order: i }));
}

export function renameStage(stages, id, label) {
  const name = checkLabel(label);
  if (!findStage(stages, id)) throw new Error('指定した段階が見つかりません');
  if (stages.some((s) => s.id !== id && s.label === name)) throw new Error('同じ名称の段階がすでにあります');
  return sortStages(stages.map((s) => (s.id === id ? { ...s, label: name } : s)));
}

/** direction: -1 で上へ、+1 で下へ */
export function moveStage(stages, id, direction) {
  const sorted = sortStages(stages);
  const i = sorted.findIndex((s) => s.id === id);
  if (i < 0) throw new Error('指定した段階が見つかりません');
  const j = i + direction;
  if (j < 0 || j >= sorted.length) return sorted;
  const next = [...sorted];
  [next[i], next[j]] = [next[j], next[i]];
  return next.map((s, k) => ({ ...s, order: k }));
}

/** 追加した段階のみ削除できる。応募で使用中の段階は削除できない */
export function removeStage(stages, id, usedStageIds = []) {
  if (BUILTIN_STAGE_IDS.includes(id)) throw new Error('既定の段階は削除できません');
  if (!findStage(stages, id)) throw new Error('指定した段階が見つかりません');
  if (usedStageIds.includes(id)) throw new Error('この段階を使用している応募があるため削除できません');
  return sortStages(stages.filter((s) => s.id !== id));
}

/** "書類選考・結果待ち" のような表示用の文字列 */
export function statusText(stages, stageId, state) {
  return `${stageLabel(stages, stageId)}・${STATE_LABELS[state] || state}`;
}
