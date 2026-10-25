// 設定：選考の段階（追加・名称変更・並べ替え・削除）、データの保存場所についての注意

import { saveSettings, listApplications, listEvents } from '../db.js';
import { sortStages, addStage, renameStage, moveStage, removeStage, BUILTIN_STAGE_IDS, STAGE_LABEL_MAX } from '../stages.js';
import { h, icon, section, openSheet, confirmDialog, showToast, showError, field } from '../ui.js';

export async function render(ctx) {
  const [applications, events] = await Promise.all([listApplications(ctx.db), listEvents(ctx.db)]);
  // 履歴で使われている段階も「使用中」とみなす（削除すると履歴の表示名が失われるため）
  const used = new Set([...applications.map((a) => a.stage), ...events.map((e) => e.stage)]);
  let stages = sortStages(ctx.settings.stages);

  const list = h('ul', { class: 'list' });

  const save = async (next, message) => {
    try {
      const saved = await saveSettings(ctx.db, { stages: next });
      stages = sortStages(saved.stages);
      ctx.settings.stages = stages;
      draw();
      if (message) showToast(message);
    } catch (err) {
      showError(err);
    }
  };

  const tryUpdate = (fn, message) => {
    try {
      save(fn(), message);
    } catch (err) {
      showError(err);
    }
  };

  const rename = async (stage) => {
    const label = await openSheet((close) => {
      const input = field({ label: '段階の名称', name: 'label', value: stage.label, attrs: { maxlength: String(STAGE_LABEL_MAX) } });
      const form = h('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); close(input.querySelector('input').value); } },
        h('h2', { class: 'dialog-title' }, '名称を変更'),
        input,
        h('div', { class: 'dialog-actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => close(undefined) }, 'キャンセル'),
          h('button', { type: 'submit', class: 'btn btn-primary' }, '保存'))
      );
      return form;
    });
    if (label !== undefined) tryUpdate(() => renameStage(stages, stage.id, label), '名称を変更しました');
  };

  const remove = async (stage) => {
    const ok = await confirmDialog({ title: `「${stage.label}」を削除しますか？`, okLabel: '削除する', danger: true });
    if (ok) tryUpdate(() => removeStage(stages, stage.id, [...used]), '段階を削除しました');
  };

  function draw() {
    list.replaceChildren(...stages.map((s, i) => {
      const builtin = BUILTIN_STAGE_IDS.includes(s.id);
      return h('li', { class: 'stage-row' },
        h('span', { class: 'stage-name' }, s.label, builtin && h('span', { class: 'builtin' }, '既定')),
        h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `${s.label}を上へ`, disabled: i === 0, onclick: () => tryUpdate(() => moveStage(stages, s.id, -1)) }, icon('up')),
        h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `${s.label}を下へ`, disabled: i === stages.length - 1, onclick: () => tryUpdate(() => moveStage(stages, s.id, 1)) }, icon('down')),
        h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `${s.label}の名称を変更`, onclick: () => rename(s) }, icon('edit')),
        h('button', {
          type: 'button', class: 'btn btn-icon', 'aria-label': `${s.label}を削除`,
          disabled: builtin || used.has(s.id),
          title: builtin ? '既定の段階は削除できません' : used.has(s.id) ? '使用中の段階は削除できません' : null,
          onclick: () => remove(s),
        }, icon('trash'))
      );
    }));
  }
  draw();

  const newInput = h('input', { type: 'text', placeholder: '例：三次面接', maxlength: String(STAGE_LABEL_MAX), 'aria-label': '追加する段階の名称' });
  const addForm = h('form', {
    class: 'inline-form',
    onsubmit: (e) => {
      e.preventDefault();
      try {
        const next = addStage(stages, newInput.value);
        newInput.value = '';
        save(next, '段階を追加しました（内定の直前に追加されます）');
      } catch (err) {
        showError(err);
      }
    },
  }, newInput, h('button', { type: 'submit', class: 'btn btn-primary' }, '追加'));

  return {
    title: '設定',
    node: h('div', {},
      section('データの保存について',
        h('div', { class: 'notice' },
          h('p', {}, 'データはすべてこの端末の中（ブラウザの IndexedDB）にだけ保存され、外部には送信されません。'),
          h('p', {}, 'アプリ内のデータは暗号化されていません。保護は iPhone 本体のロック（パスコード・Face ID）に依存します。'),
          h('p', {}, 'Safari で開いた場合とホーム画面のアプリでは保存場所が別です。ホーム画面に追加して使ってください。'),
          h('p', {}, '暗号化バックアップは Phase 2 で追加予定です。')
        )
      ),
      section('選考の段階',
        h('p', { class: 'muted' }, '名称の変更と並べ替えができます。追加した段階は、使用している応募がなければ削除できます。'),
        list, addForm
      ),
      section('アプリ情報', h('dl', { class: 'info' },
        h('div', { class: 'info-row' }, h('dt', {}, 'バージョン'), h('dd', {}, ctx.appVersion))
      ))
    ),
  };
}
