// 応募の登録・編集（基本情報）。ステータスは登録時の初期値のみここで決め、以降は詳細画面から changeStatus() で変更する

import { getApplication, getCompany, listCompanies } from '../db.js';
import { createApplication, updateApplication, defaultInitialStatus } from '../status.js';
import { CHANNELS, CHANNEL_LABELS } from '../stages.js';
import { h, icon, field, formValues, showFieldErrors, showToast, showError, emptyState, toDateInput } from '../ui.js';
import { statusFields } from './status-form.js';

export async function render(ctx) {
  const id = ctx.route.params.id || null;
  const app = id ? await getApplication(ctx.db, id) : null;
  if (id && !app) return { title: '応募', node: emptyState('応募が見つかりません。削除された可能性があります。') };
  const companies = await listCompanies(ctx.db);

  if (!id && companies.length === 0) {
    return {
      title: '応募を追加',
      node: emptyState('応募を登録するには、先に企業を登録してください。',
        h('a', { class: 'btn btn-primary', href: '#/company/new' }, icon('plus'), '企業を追加')),
    };
  }

  const a = app || { channel: 'direct', companyId: ctx.route.query.companyId || '' };
  const company = id ? await getCompany(ctx.db, a.companyId) : null;
  const today = toDateInput(new Date().toISOString());

  const companyControl = id
    ? h('div', { class: 'field' }, h('label', {}, '企業'), h('p', { class: 'list-item-title' }, company ? company.name : '（削除された企業）'))
    : field({
      label: '企業', name: 'companyId', type: 'select', value: a.companyId, required: true,
      options: [['', '選択してください'], ...companies.map((c) => [c.id, c.name])],
      hint: '一覧にない企業は「＋」→「企業を追加」から先に登録してください',
    });

  const appliedField = field({ label: '応募日', name: 'appliedAt', type: 'date', value: id ? toDateInput(a.appliedAt) : today, hint: 'まだ応募していない場合は空欄にしてください' });

  const formError = h('p', { class: 'form-error', role: 'alert' });
  const groups = [
    h('div', { class: 'form-group' },
      companyControl,
      field({ label: '職種', name: 'position', value: a.position, placeholder: '例：Webエンジニア' }),
      h('div', { class: 'field-row' },
        field({ label: '応募経路', name: 'channel', type: 'select', value: a.channel, options: CHANNELS.map((c) => [c, CHANNEL_LABELS[c]]) }),
        appliedField
      ),
      field({ label: 'メモ', name: 'memo', type: 'textarea', value: a.memo, rows: 3 })
    ),
  ];

  let statusGroup = null;
  if (!id) {
    // 新規登録時のみ初期ステータスを入力する。応募日の有無に合わせて既定値を切り替える（手で変えた後は追従しない）
    const initial = defaultInitialStatus(today);
    statusGroup = statusFields({ stages: ctx.settings.stages, ...initial, withMemo: false });
    let touched = false;
    statusGroup.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => { touched = true; }));
    appliedField.querySelector('input').addEventListener('change', (e) => {
      if (touched) return;
      const next = defaultInitialStatus(e.target.value || null);
      statusGroup.querySelector('[name="stage"]').value = next.stage;
      const stateSel = statusGroup.querySelector('[name="state"]');
      stateSel.value = next.state;
      statusGroup.querySelector('[name="stage"]').dispatchEvent(new Event('change'));
      touched = false;
    });
    groups.push(h('h2', { class: 'section-title' }, '現在のステータス'), statusGroup);
  }

  const form = h('form', { class: 'form', novalidate: true }, ...groups, formError);

  let saving = false;
  const submit = async (e) => {
    e?.preventDefault();
    if (saving) return;
    saving = true;
    const values = formValues(form);
    try {
      if (id) {
        await updateApplication(ctx.db, id, values);
        showToast('応募を更新しました');
        ctx.navigate(`/application/${encodeURIComponent(id)}`, { replace: true });
      } else {
        const { application } = await createApplication(ctx.db, values);
        showToast('応募を登録しました');
        ctx.navigate(`/application/${encodeURIComponent(application.id)}`, { replace: true });
      }
    } catch (err) {
      saving = false;
      if (err.name === 'ValidationError') {
        showFieldErrors(form, err.errors);
        formError.textContent = err.errors.status || '入力内容を確認してください';
      } else {
        showError(err);
      }
    }
  };
  form.addEventListener('submit', submit);

  const actions = h('div', { class: 'action-bar' },
    h('button', { type: 'button', class: 'btn', onclick: () => ctx.goBack() }, 'キャンセル'),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: submit }, id ? '保存' : '登録')
  );

  return { title: id ? '応募を編集' : '応募を追加', node: h('div', {}, form, actions), hasActions: true };
}
