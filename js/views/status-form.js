// ステータス（段階・状態）と選考の日時・場所の入力欄。応募の登録画面とステータス変更で共用する

import { h, field, toLocalInput } from '../ui.js';
import { sortStages, STATES, STATE_LABELS, OFFER_STAGE_ID } from '../stages.js';

/**
 * @param {object} o { stages, stage, state, event: { scheduledAt, endAt, place, onlineUrl, memo }, withMemo }
 * @returns {HTMLElement} 入力欄のまとまり
 */
export function statusFields({ stages, stage, state, event = {}, withMemo = true }) {
  const stageField = field({
    label: '段階', name: 'stage', type: 'select', value: stage,
    options: sortStages(stages).map((s) => [s.id, s.label]),
  });
  const stateField = field({
    label: '状態', name: 'state', type: 'select', value: state,
    options: STATES.map((s) => [s, STATE_LABELS[s]]),
    hint: '「承諾」は内定の段階でのみ選べます。不合格・辞退にすると応募は「終了」になります',
  });
  const stageSelect = stageField.querySelector('select');
  const stateSelect = stateField.querySelector('select');
  // offer 以外では「承諾」を選べないようにする（保存時にも changeStatus で検証する）
  const syncAccepted = () => {
    const accepted = stateSelect.querySelector('option[value="accepted"]');
    accepted.disabled = stageSelect.value !== OFFER_STAGE_ID;
    if (accepted.disabled && stateSelect.value === 'accepted') stateSelect.value = 'waiting';
  };
  stageSelect.addEventListener('change', syncAccepted);
  syncAccepted();

  return h('div', { class: 'form-group' },
    h('div', { class: 'field-row' }, stageField, stateField),
    field({ label: '日時', name: 'scheduledAt', type: 'datetime-local', value: toLocalInput(event.scheduledAt) }),
    field({ label: '終了日時', name: 'endAt', type: 'datetime-local', value: toLocalInput(event.endAt) }),
    field({ label: '場所', name: 'place', value: event.place, placeholder: '本社 3F、オンライン など' }),
    field({ label: 'オンラインURL', name: 'onlineUrl', type: 'url', value: event.onlineUrl, placeholder: 'https://', attrs: { inputmode: 'url', autocapitalize: 'off' } }),
    withMemo && field({ label: 'メモ', name: 'memo', type: 'textarea', value: event.memo, rows: 2 })
  );
}
