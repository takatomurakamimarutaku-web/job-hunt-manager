// 企業の詳細：基本情報と応募の一覧。削除時は関連データの件数を示し、5秒間「元に戻す」を出す

import { getCompany, listApplicationsByCompany, countCompanyCascade, deleteCompany, restoreSnapshot } from '../db.js';
import { CHANNEL_LABELS, statusText, isClosed } from '../stages.js';
import { isSafeUrl } from '../validate.js';
import { h, icon, section, emptyState, stars, formatDate, externalLink, confirmDialog, showToast, showError } from '../ui.js';

function infoRow(label, value) {
  if (value === null || value === undefined || value === '') return null;
  return h('div', { class: 'info-row' }, h('dt', {}, label), h('dd', {}, value));
}

export function salaryText(min, max) {
  if (min === null && max === null) return '';
  if (min !== null && max !== null) return `${min}〜${max}万円`;
  return min !== null ? `${min}万円〜` : `〜${max}万円`;
}

export async function render(ctx) {
  const { id } = ctx.route.params;
  const company = await getCompany(ctx.db, id);
  if (!company) {
    return { title: '企業', node: emptyState('企業が見つかりません。削除された可能性があります。', h('a', { class: 'btn', href: '#/companies' }, '企業一覧へ')) };
  }
  const applications = await listApplicationsByCompany(ctx.db, id);
  const { stages } = ctx.settings;

  const onDelete = async () => {
    try {
      const n = await countCompanyCascade(ctx.db, id);
      const details = [
        `応募 ${n.applications}件`,
        `選考イベント ${n.events}件`,
        `タスク ${n.tasks}件`,
        `面接記録 ${n.interviews}件`,
      ];
      if (n.contacts > 0) details.push(`担当者 ${n.contacts}件は削除されず、この企業との紐づけだけが外れます`);
      const ok = await confirmDialog({
        title: `「${company.name}」を削除しますか？`,
        message: '次の関連データもあわせて削除されます。',
        details,
        okLabel: '削除する',
        danger: true,
      });
      if (!ok) return;
      const snapshot = await deleteCompany(ctx.db, id);
      ctx.navigate('/companies', { replace: true });
      showToast(`「${company.name}」を削除しました`, {
        duration: 5000,
        action: {
          label: '元に戻す',
          onClick: async () => {
            try {
              await restoreSnapshot(ctx.db, snapshot);
              showToast('元に戻しました');
              ctx.navigate(`/company/${encodeURIComponent(id)}`, { replace: true });
            } catch (err) {
              showError(err);
            }
          },
        },
      });
    } catch (err) {
      showError(err);
    }
  };

  const head = h('div', { class: 'detail-head' },
    h('h2', { class: 'detail-title' }, company.name),
    h('div', { class: 'detail-meta' },
      stars(company.interestLevel),
      ...(company.tags || []).map((t) => h('span', { class: 'tag' }, t)))
  );

  const info = h('dl', { class: 'info' },
    infoRow('業種', company.industry),
    infoRow('URL', isSafeUrl(company.url) ? externalLink(company.url) : company.url),
    infoRow('所在地', company.location),
    infoRow('従業員数', company.employees !== null ? `${company.employees.toLocaleString()}人` : ''),
    infoRow('設立', company.founded !== null ? `${company.founded}年` : ''),
    infoRow('上場区分', company.listing),
    infoRow('年収レンジ', salaryText(company.salaryMin, company.salaryMax)),
    infoRow('働き方', company.workStyle),
    infoRow('事業内容', company.business),
    infoRow('メモ', company.memo)
  );
  const hasInfo = info.children.length > 0;

  const appList = applications.length === 0
    ? emptyState('この企業への応募はまだありません。')
    : h('ul', { class: 'list' }, applications.map((a) =>
      h('li', {}, h('a', { class: 'list-item', href: `#/application/${encodeURIComponent(a.id)}` },
        h('div', { class: 'list-item-body' },
          h('div', { class: 'list-item-title' }, a.position || '職種 未入力'),
          h('div', { class: 'list-item-sub' }, [CHANNEL_LABELS[a.channel], a.appliedAt && `応募日 ${formatDate(a.appliedAt)}`].filter(Boolean).join('・')),
          h('div', { class: 'list-item-meta' },
            h('span', { class: `badge state-${a.state}` }, statusText(stages, a.stage, a.state)),
            isClosed(a.state) && h('span', { class: 'badge' }, '終了'))
        ),
        icon('chevron')
      ))
    ));

  const actions = h('div', { class: 'action-bar' },
    h('button', { type: 'button', class: 'btn btn-icon btn-danger-outline', 'aria-label': '企業を削除', onclick: onDelete }, icon('trash')),
    h('a', { class: 'btn', href: `#/company/${encodeURIComponent(id)}/edit` }, icon('edit'), '編集'),
    h('a', { class: 'btn btn-primary', href: `#/application/new?companyId=${encodeURIComponent(id)}` }, icon('plus'), '応募を追加')
  );

  return {
    title: '企業',
    hasActions: true,
    node: h('div', {},
      head,
      hasInfo ? info : h('p', { class: 'muted' }, '基本情報はまだ入力されていません。'),
      section(`応募（${applications.length}件）`, appList),
      actions
    ),
  };
}
