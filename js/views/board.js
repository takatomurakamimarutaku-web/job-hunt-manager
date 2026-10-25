// 応募（暫定版）：段階ごとに応募を一覧する。カンバン表示は Phase 4 で実装する

import { listApplications, listCompanies, listEvents, latestEventByApplication } from '../db.js';
import { sortStages, STATE_LABELS, isClosed } from '../stages.js';
import { h, icon, emptyState, formatDateTime } from '../ui.js';

let showClosed = false; // アプリを閉じるまで保持

export async function render(ctx) {
  const [applications, companies, events] = await Promise.all([
    listApplications(ctx.db), listCompanies(ctx.db), listEvents(ctx.db),
  ]);
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const latest = latestEventByApplication(events);
  const nowIso = new Date().toISOString();

  if (applications.length === 0) {
    return {
      title: '応募',
      node: emptyState('まだ応募が登録されていません。', h('a', { class: 'btn btn-primary', href: '#/application/new' }, icon('plus'), '応募を追加')),
    };
  }

  const container = h('div');
  const draw = () => {
    const visible = applications.filter((a) => showClosed || !isClosed(a.state));
    const groups = sortStages(ctx.settings.stages).map((stage) => {
      const items = visible
        .filter((a) => a.stage === stage.id)
        .sort((x, y) => (y.updatedAt > x.updatedAt ? 1 : -1));
      if (items.length === 0) return null;
      return h('section', { class: 'board-group' },
        h('h2', { class: 'board-group-head' }, stage.label, h('span', { class: 'board-count' }, `${items.length}件`)),
        h('ul', { class: 'list' }, items.map((a) => {
          const ev = latest.get(a.id);
          const next = ev && ev.scheduledAt && (ev.endAt || ev.scheduledAt) >= nowIso ? `次の予定 ${formatDateTime(ev.scheduledAt)}` : '';
          const company = companyById.get(a.companyId);
          return h('li', {}, h('a', { class: 'list-item', href: `#/application/${encodeURIComponent(a.id)}` },
            h('div', { class: 'list-item-body' },
              h('div', { class: 'list-item-title' }, company ? company.name : '（削除された企業）'),
              h('div', { class: 'list-item-sub' }, [a.position, next].filter(Boolean).join('・') || ' '),
              h('div', { class: 'list-item-meta' },
                h('span', { class: `badge state-${a.state}` }, STATE_LABELS[a.state]),
                isClosed(a.state) && h('span', { class: 'badge' }, '終了'))
            ),
            icon('chevron')
          ));
        }))
      );
    }).filter(Boolean);
    container.replaceChildren(...(groups.length ? groups : [emptyState('進行中の応募はありません。')]));
  };

  const toggle = h('label', { class: 'toggle' },
    h('input', { type: 'checkbox', checked: showClosed, onchange: (e) => { showClosed = e.target.checked; draw(); } }),
    `終了した応募（不合格・辞退）も表示する（${applications.filter((a) => isClosed(a.state)).length}件）`
  );
  draw();
  return {
    title: '応募',
    headerActions: [h('a', { class: 'btn btn-small btn-primary', href: '#/application/new' }, '追加')],
    node: h('div', {}, h('p', { class: 'notice notice-info' }, 'カンバン表示は Phase 4 で追加予定です。'), toggle, container),
  };
}
