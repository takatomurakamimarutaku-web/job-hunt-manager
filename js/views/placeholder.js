// まだ実装していない画面（後のフェーズで追加する）

import { h, emptyState } from '../ui.js';

const PLANNED = {
  tasks: { title: 'タスク', phase: 3, text: 'タスクの登録・期限管理と、選考に合わせたタスクの自動生成を追加します。' },
  questions: { title: '質問バンク', phase: 5, text: '面接で聞かれた質問とベストな回答を蓄積できるようにします。' },
  documents: { title: '応募書類', phase: 5, text: '志望動機・自己PRなどを版ごとに管理できるようにします。' },
  contacts: { title: '担当者・エージェント', phase: 5, text: '担当者の連絡先とやり取りの記録を管理できるようにします。' },
  compare: { title: '企業比較', phase: 6, text: '評価軸ごとの採点と重み付けスコアで企業を比較できるようにします。' },
  stats: { title: '統計', phase: 7, text: '応募数・通過率・選考期間などを集計します。' },
};

export async function render(ctx) {
  const plan = PLANNED[ctx.route.name];
  if (!plan) {
    return {
      title: 'ページが見つかりません',
      node: emptyState('このページは存在しません。', h('a', { class: 'btn', href: '#/home' }, 'ホームへ')),
    };
  }
  return {
    title: plan.title,
    node: h('div', {},
      emptyState(`この機能は Phase ${plan.phase} で追加予定です。`),
      h('p', { class: 'muted' }, plan.text)
    ),
  };
}
