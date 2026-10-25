// 「＋」タブ：何を追加するかを選ぶ

import { h, icon } from '../ui.js';

export async function render() {
  return {
    title: '追加',
    node: h('div', { class: 'menu-grid' },
      h('a', { class: 'menu-button', href: '#/company/new' },
        icon('building'), h('span', {}, '企業を追加', h('small', {}, '企業の基本情報を登録します'))),
      h('a', { class: 'menu-button', href: '#/application/new' },
        icon('briefcase'), h('span', {}, '応募を追加', h('small', {}, '登録済みの企業への応募を記録します'))),
      h('div', { class: 'menu-button', 'aria-disabled': 'true' },
        icon('calendar'), h('span', { class: 'muted' }, 'タスクを追加', h('small', {}, 'Phase 3 で追加予定')))
    ),
  };
}
