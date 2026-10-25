// 企業の登録・編集。企業名の入力中に既存の企業を候補表示して重複登録を防ぐ

import { getCompany, listCompanies, saveCompany } from '../db.js';
import { findSimilarCompanies } from '../search.js';
import { LISTINGS } from '../stages.js';
import { h, field, formValues, showFieldErrors, showToast, showError, confirmDialog, emptyState } from '../ui.js';

const SIMILAR_LABEL = { exact: '同じ名前', prefix: '似た名前', partial: '似た名前' };

export async function render(ctx) {
  const id = ctx.route.params.id || null;
  const [company, all] = await Promise.all([id ? getCompany(ctx.db, id) : null, listCompanies(ctx.db)]);
  if (id && !company) return { title: '企業', node: emptyState('企業が見つかりません。削除された可能性があります。') };
  const c = company || {};
  const others = all.filter((x) => x.id !== id);

  const suggestBox = h('div', { class: 'suggest', hidden: true });
  const updateSuggest = (name) => {
    const hits = findSimilarCompanies(others, name, 5);
    suggestBox.hidden = hits.length === 0;
    suggestBox.replaceChildren(
      h('p', {}, '登録済みの企業に似た名前があります。同じ企業ならタップして開いてください。'),
      h('ul', { class: 'suggest-list' }, hits.map(({ company: hit, match }) =>
        h('li', {}, h('button', {
          type: 'button',
          onclick: () => ctx.navigate(`/company/${encodeURIComponent(hit.id)}`),
        }, `${hit.name}（${SIMILAR_LABEL[match]}）`))
      ))
    );
  };

  const nameField = field({ label: '企業名', name: 'name', value: c.name, required: true, attrs: { autocomplete: 'off', maxlength: '100' } });
  const nameInput = nameField.querySelector('input');
  nameInput.addEventListener('input', () => updateSuggest(nameInput.value));
  nameField.append(suggestBox);

  const formError = h('p', { class: 'form-error', role: 'alert' });
  const form = h('form', { class: 'form', novalidate: true },
    h('div', { class: 'form-group' },
      nameField,
      field({ label: '業種', name: 'industry', value: c.industry, placeholder: '例：ITサービス' }),
      field({ label: 'URL', name: 'url', type: 'url', value: c.url, placeholder: 'https://', attrs: { inputmode: 'url', autocapitalize: 'off' } }),
      field({ label: '所在地', name: 'location', value: c.location, placeholder: '例：東京都千代田区' }),
      h('div', { class: 'field-row' },
        field({ label: '従業員数（人）', name: 'employees', value: c.employees ?? '', attrs: { inputmode: 'numeric' } }),
        field({ label: '設立年（西暦）', name: 'founded', value: c.founded ?? '', attrs: { inputmode: 'numeric' } })
      ),
      field({ label: '上場区分', name: 'listing', type: 'select', value: c.listing ?? '', options: LISTINGS.map((v) => [v, v || '未選択']) })
    ),
    h('div', { class: 'form-group' },
      h('div', { class: 'field-row' },
        field({ label: '年収 下限（万円）', name: 'salaryMin', value: c.salaryMin ?? '', attrs: { inputmode: 'numeric' } }),
        field({ label: '年収 上限（万円）', name: 'salaryMax', value: c.salaryMax ?? '', attrs: { inputmode: 'numeric' } })
      ),
      field({ label: '志望度', name: 'interestLevel', type: 'select', value: c.interestLevel ?? '',
        options: [['', '未設定'], ['5', '★★★★★（5）'], ['4', '★★★★☆（4）'], ['3', '★★★☆☆（3）'], ['2', '★★☆☆☆（2）'], ['1', '★☆☆☆☆（1）']] }),
      field({ label: '働き方', name: 'workStyle', type: 'textarea', value: c.workStyle, rows: 2, placeholder: 'リモート可否、フレックス、残業など' }),
      field({ label: 'タグ', name: 'tags', value: (c.tags || []).join(', '), placeholder: 'カンマ区切り（例：SaaS, リモート）' })
    ),
    h('div', { class: 'form-group' },
      field({ label: '事業内容', name: 'business', type: 'textarea', value: c.business, rows: 3 }),
      field({ label: 'メモ', name: 'memo', type: 'textarea', value: c.memo, rows: 3 })
    ),
    formError
  );

  let saving = false;
  const submit = async (e) => {
    e?.preventDefault();
    if (saving) return;
    const values = formValues(form);
    const exact = findSimilarCompanies(others, values.name, 1).find((x) => x.match === 'exact');
    if (exact) {
      const ok = await confirmDialog({
        title: '同じ名前の企業があります',
        message: `「${exact.company.name}」がすでに登録されています。別の企業として登録しますか？`,
        okLabel: '登録する',
      });
      if (!ok) return;
    }
    saving = true;
    try {
      const saved = await saveCompany(ctx.db, { ...values, id: id || undefined });
      showToast(id ? '企業を更新しました' : '企業を登録しました');
      // 保存後はフォームを履歴に残さない（戻るでフォームに戻らないようにする）
      ctx.navigate(`/company/${encodeURIComponent(saved.id)}`, { replace: true });
    } catch (err) {
      saving = false;
      if (err.name === 'ValidationError') {
        showFieldErrors(form, err.errors);
        formError.textContent = '入力内容を確認してください';
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

  return { title: id ? '企業を編集' : '企業を追加', node: h('div', {}, form, actions), hasActions: true };
}
