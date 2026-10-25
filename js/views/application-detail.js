// 応募の詳細：現在のステータス、ステータス変更、選考イベントの履歴（時系列）

import { getApplication, getCompany, listEventsByApplication, countApplicationCascade, deleteApplication, restoreSnapshot } from '../db.js';
import { changeStatus, updateEvent, sortHistory } from '../status.js';
import { CHANNEL_LABELS, statusText, isClosed } from '../stages.js';
import { isSafeUrl } from '../validate.js';
import {
  h, icon, section, emptyState, formatDate, formatDateTime, externalLink, field, toLocalInput,
  confirmDialog, openSheet, formValues, showFieldErrors, showToast, showError,
} from '../ui.js';
import { statusFields } from './status-form.js';

/** フォームを持つシート。onSubmit が例外（ValidationError）を投げたらフォームにエラーを出す */
function formSheet({ title, body, submitLabel, onSubmit }) {
  return openSheet((close) => {
    const formError = h('p', { class: 'form-error', role: 'alert' });
    const form = h('form', { class: 'form', novalidate: true },
      h('h2', { class: 'dialog-title' }, title),
      body,
      formError,
      h('div', { class: 'dialog-actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => close(false) }, 'キャンセル'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, submitLabel)
      )
    );
    let busy = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      try {
        await onSubmit(formValues(form));
        close(true);
      } catch (err) {
        busy = false;
        if (err.name === 'ValidationError') {
          showFieldErrors(form, err.errors);
          formError.textContent = err.errors.status || '入力内容を確認してください';
        } else {
          showError(err);
        }
      }
    });
    return form;
  });
}

function eventRows(ev) {
  const rows = [];
  if (ev.scheduledAt) {
    const sameDay = ev.endAt && toLocalInput(ev.endAt).slice(0, 10) === toLocalInput(ev.scheduledAt).slice(0, 10);
    const end = ev.endAt ? `〜${sameDay ? formatDateTime(ev.endAt).slice(-5) : formatDateTime(ev.endAt)}` : '';
    rows.push(h('div', { class: 'timeline-row' }, icon('calendar'), h('span', {}, `${formatDateTime(ev.scheduledAt)}${end}`)));
  }
  if (ev.place) rows.push(h('div', { class: 'timeline-row' }, icon('pin'), h('span', {}, ev.place)));
  if (ev.onlineUrl) {
    rows.push(h('div', { class: 'timeline-row' }, icon('link'), isSafeUrl(ev.onlineUrl) ? externalLink(ev.onlineUrl) : h('span', {}, ev.onlineUrl)));
  }
  if (ev.memo) rows.push(h('div', { class: 'timeline-row' }, h('span', { class: 'muted' }, ev.memo)));
  return rows;
}

export async function render(ctx) {
  const { id } = ctx.route.params;
  const app = await getApplication(ctx.db, id);
  if (!app) {
    return { title: '応募', node: emptyState('応募が見つかりません。削除された可能性があります。', h('a', { class: 'btn', href: '#/board' }, '応募一覧へ')) };
  }
  const [company, events] = await Promise.all([getCompany(ctx.db, app.companyId), listEventsByApplication(ctx.db, id)]);
  const { stages } = ctx.settings;
  const history = sortHistory(events);
  const latest = history.at(-1) || null;

  const onChangeStatus = async () => {
    const saved = await formSheet({
      title: 'ステータスを変更',
      submitLabel: '変更する',
      body: h('div', {},
        h('p', { class: 'muted' }, `現在：${statusText(stages, app.stage, app.state)}`),
        statusFields({ stages, stage: app.stage, state: app.state })
      ),
      onSubmit: (values) => changeStatus(ctx.db, id, values),
    });
    if (saved) {
      showToast('ステータスを変更しました');
      ctx.refresh();
    }
  };

  const onEditEvent = async (ev) => {
    const saved = await formSheet({
      title: `${statusText(stages, ev.stage, ev.state)} の予定を修正`,
      submitLabel: '保存',
      body: h('div', { class: 'form-group' },
        field({ label: '日時', name: 'scheduledAt', type: 'datetime-local', value: toLocalInput(ev.scheduledAt) }),
        field({ label: '終了日時', name: 'endAt', type: 'datetime-local', value: toLocalInput(ev.endAt) }),
        field({ label: '場所', name: 'place', value: ev.place }),
        field({ label: 'オンラインURL', name: 'onlineUrl', type: 'url', value: ev.onlineUrl, attrs: { inputmode: 'url', autocapitalize: 'off' } }),
        field({ label: 'メモ', name: 'memo', type: 'textarea', value: ev.memo, rows: 2 })
      ),
      onSubmit: (values) => updateEvent(ctx.db, ev.id, values),
    });
    if (saved) {
      showToast('予定を修正しました');
      ctx.refresh();
    }
  };

  const onDelete = async () => {
    try {
      const n = await countApplicationCascade(ctx.db, id);
      const ok = await confirmDialog({
        title: 'この応募を削除しますか？',
        message: '次の関連データもあわせて削除されます。',
        details: [`選考イベント ${n.events}件`, `タスク ${n.tasks}件`, `面接記録 ${n.interviews}件`],
        okLabel: '削除する',
        danger: true,
      });
      if (!ok) return;
      const snapshot = await deleteApplication(ctx.db, id);
      ctx.navigate(company ? `/company/${encodeURIComponent(company.id)}` : '/board', { replace: true });
      showToast('応募を削除しました', {
        duration: 5000,
        action: {
          label: '元に戻す',
          onClick: async () => {
            try {
              await restoreSnapshot(ctx.db, snapshot);
              showToast('元に戻しました');
              ctx.navigate(`/application/${encodeURIComponent(id)}`, { replace: true });
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
    company
      ? h('a', { href: `#/company/${encodeURIComponent(company.id)}`, class: 'detail-sub' }, company.name)
      : h('p', { class: 'detail-sub' }, '（削除された企業）'),
    h('h2', { class: 'detail-title' }, app.position || '職種 未入力'),
    h('div', { class: 'detail-meta' },
      h('span', { class: `badge badge-large state-${app.state}` }, statusText(stages, app.stage, app.state)),
      isClosed(app.state) && h('span', { class: 'badge' }, '終了'))
  );

  const next = latest && latest.scheduledAt ? h('div', { class: 'card' }, h('div', { class: 'section-title' }, '現在の予定'), ...eventRows(latest)) : null;

  const info = h('dl', { class: 'info' },
    h('div', { class: 'info-row' }, h('dt', {}, '応募経路'), h('dd', {}, CHANNEL_LABELS[app.channel] || app.channel)),
    h('div', { class: 'info-row' }, h('dt', {}, '応募日'), h('dd', {}, app.appliedAt ? formatDate(app.appliedAt) : '未応募')),
    app.memo && h('div', { class: 'info-row' }, h('dt', {}, 'メモ'), h('dd', {}, app.memo))
  );

  const timeline = history.length === 0
    ? emptyState('選考の履歴はまだありません。')
    : h('ol', { class: 'timeline' }, history.map((ev, i) =>
      h('li', { class: `timeline-item${i === history.length - 1 ? ' current' : ''}` },
        h('div', { class: 'timeline-card' },
          h('div', { class: 'timeline-head' },
            h('span', { class: 'timeline-title' }, statusText(stages, ev.stage, ev.state)),
            h('button', { type: 'button', class: 'btn-link', onclick: () => onEditEvent(ev), 'aria-label': '予定を修正' }, '修正')
          ),
          ...eventRows(ev),
          h('div', { class: 'timeline-recorded' }, `記録：${formatDateTime(ev.createdAt)}`)
        )
      )
    ));

  const actions = h('div', { class: 'action-bar' },
    h('button', { type: 'button', class: 'btn btn-icon btn-danger-outline', 'aria-label': '応募を削除', onclick: onDelete }, icon('trash')),
    h('a', { class: 'btn', href: `#/application/${encodeURIComponent(id)}/edit` }, icon('edit'), '編集'),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: onChangeStatus }, 'ステータス変更')
  );

  return {
    title: '応募',
    hasActions: true,
    node: h('div', {}, head, next, section(null, info), section('選考の履歴（古い順）', timeline), actions),
  };
}
