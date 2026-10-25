// ホーム：進行中の応募数と直近の選考予定（タスクの表示は Phase 3 で追加）

import { getHomeSummary, listCompanies } from '../db.js';
import { statusText } from '../stages.js';
import { h, icon, section, emptyState, formatDateTime, relativeDay } from '../ui.js';

export async function render(ctx) {
  const now = new Date();
  const [summary, companies] = await Promise.all([getHomeSummary(ctx.db, now, 5), listCompanies(ctx.db)]);
  const { stages } = ctx.settings;

  if (companies.length === 0) {
    return {
      title: 'ホーム',
      node: h('div', {},
        section(null, emptyState('まだ企業が登録されていません。まずは気になる企業を登録しましょう。',
          h('a', { class: 'btn btn-primary', href: '#/company/new' }, icon('plus'), '企業を追加'))),
        h('p', { class: 'notice notice-info' },
          'データはこの端末の中だけに保存されます。iPhone ではホーム画面に追加して使ってください（Safari のままだと、長期間使わない場合にデータが削除されることがあります）。')
      ),
    };
  }

  const cards = h('div', { class: 'summary-grid' },
    h('a', { class: 'summary-card primary', href: '#/board' },
      h('span', { class: 'summary-value' }, String(summary.activeCount)), h('span', { class: 'summary-label' }, '進行中')),
    h('a', { class: 'summary-card', href: '#/board' },
      h('span', { class: 'summary-value' }, String(summary.offerCount)), h('span', { class: 'summary-label' }, '内定')),
    h('a', { class: 'summary-card', href: '#/board' },
      h('span', { class: 'summary-value' }, String(summary.closedCount)), h('span', { class: 'summary-label' }, '終了'))
  );

  const upcoming = summary.upcoming.length === 0
    ? emptyState('予定されている選考はありません。')
    : h('ul', { class: 'list' }, summary.upcoming.map(({ event, application, company }) =>
      h('li', {}, h('a', { class: 'list-item', href: `#/application/${encodeURIComponent(application.id)}` },
        h('div', { class: 'date-chip' },
          h('strong', {}, relativeDay(event.scheduledAt, now)),
          h('span', {}, formatDateTime(event.scheduledAt).slice(5))
        ),
        h('div', { class: 'list-item-body' },
          h('div', { class: 'list-item-title' }, company ? company.name : '（削除された企業）'),
          h('div', { class: 'list-item-sub' }, [application.position, event.place].filter(Boolean).join('・') || ' '),
          h('div', { class: 'list-item-meta' },
            h('span', { class: `badge state-${application.state}` }, statusText(stages, application.stage, application.state)))
        ),
        icon('chevron')
      ))
    ));

  return {
    title: 'ホーム',
    node: h('div', {},
      cards,
      section('直近の選考予定', upcoming),
      section('タスク', h('p', { class: 'muted' }, '期限切れ・今日・今週のタスクは Phase 3 で表示されるようになります。'))
    ),
  };
}
