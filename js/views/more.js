// 「その他」タブ

import { h, icon } from '../ui.js';

const ITEMS = [
  { href: '#/companies', icon: 'building', label: '企業' },
  { href: '#/questions', icon: 'question', label: '質問バンク', phase: 5 },
  { href: '#/documents', icon: 'doc', label: '応募書類', phase: 5 },
  { href: '#/contacts', icon: 'people', label: '担当者・エージェント', phase: 5 },
  { href: '#/compare', icon: 'compare', label: '企業比較', phase: 6 },
  { href: '#/stats', icon: 'stats', label: '統計', phase: 7 },
  { href: '#/backup', icon: 'doc', label: 'バックアップと復元' },
  { href: '#/settings', icon: 'gear', label: '設定' },
];

export async function render() {
  return {
    title: 'その他',
    node: h('ul', { class: 'list' }, ITEMS.map((item) =>
      h('li', {}, h('a', { class: 'list-item', href: item.href },
        icon(item.icon, 'icon lead-icon'),
        h('span', { class: 'list-item-body list-item-title' }, item.label),
        item.phase && h('span', { class: 'phase-label' }, `Phase ${item.phase}`),
        icon('chevron')
      ))
    )),
  };
}
