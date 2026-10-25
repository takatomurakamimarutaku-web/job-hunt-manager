// 企業一覧

import { listCompanies, listApplications } from '../db.js';
import { matches } from '../search.js';
import { isClosed } from '../stages.js';
import { h, icon, emptyState, stars } from '../ui.js';

let lastQuery = ''; // 画面を移動しても検索語を保持する（アプリを閉じるまで）

export async function render(ctx) {
  const [companies, applications] = await Promise.all([listCompanies(ctx.db), listApplications(ctx.db)]);
  const countBy = new Map();
  for (const a of applications) {
    const c = countBy.get(a.companyId) || { total: 0, active: 0 };
    c.total++;
    if (!isClosed(a.state)) c.active++;
    countBy.set(a.companyId, c);
  }

  const listEl = h('ul', { class: 'list' });
  const emptyEl = h('div');
  const draw = () => {
    const hits = companies.filter((c) => matches([c.name, c.industry, c.location, ...(c.tags || [])].join(' '), lastQuery));
    listEl.replaceChildren(...hits.map((c) => {
      const cnt = countBy.get(c.id) || { total: 0, active: 0 };
      return h('li', {}, h('a', { class: 'list-item', href: `#/company/${encodeURIComponent(c.id)}` },
        h('div', { class: 'list-item-body' },
          h('div', { class: 'list-item-title' }, c.name),
          h('div', { class: 'list-item-sub' }, [c.industry, c.location].filter(Boolean).join('・') || '業種 未入力'),
          h('div', { class: 'list-item-meta' },
            stars(c.interestLevel),
            h('span', { class: 'badge' }, cnt.total ? `応募 ${cnt.total}件（進行中 ${cnt.active}）` : '応募なし'))
        ),
        icon('chevron')
      ));
    }));
    listEl.hidden = hits.length === 0;
    emptyEl.replaceChildren(hits.length === 0 && companies.length > 0 ? emptyState('該当する企業がありません。') : '');
  };

  const search = h('input', {
    type: 'search', placeholder: '企業名・業種・タグで検索', 'aria-label': '企業を検索', value: lastQuery,
    oninput: (e) => { lastQuery = e.target.value; draw(); },
  });

  if (companies.length === 0) {
    return {
      title: '企業',
      headerActions: [h('a', { class: 'btn btn-small btn-primary', href: '#/company/new' }, '追加')],
      node: emptyState('まだ企業が登録されていません。', h('a', { class: 'btn btn-primary', href: '#/company/new' }, icon('plus'), '企業を追加')),
    };
  }
  draw();
  return {
    title: '企業',
    headerActions: [h('a', { class: 'btn btn-small btn-primary', href: '#/company/new' }, '追加')],
    node: h('div', {}, h('div', { class: 'search-box' }, search), h('p', { class: 'muted' }, `${companies.length}社`), listEl, emptyEl),
  };
}
