// 画面共通の部品
// ユーザー入力は必ず textContent で描画し、innerHTML には渡さない（XSS対策）。

/**
 * 要素を作る。h('button', { class: 'btn', onclick: fn }, '保存')
 * - on〜 はイベント、class / dataset / その他は属性・プロパティとして設定する
 * - children の文字列はテキストノードになる。null / false は無視する
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.className = value;
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key in el && typeof value !== 'string') {
      el[key] = value;
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** SVGアイコン（index.html と同じ線画スタイル） */
const ICONS = {
  chevron: 'M9 5l7 7-7 7',
  edit: 'M4 20h4l10-10-4-4L4 16zM13 7l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  plus: 'M12 5v14M5 12h14',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  pin: 'M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  building: 'M4 21V5l8-2v18M12 21h8V9l-8-2M8 8h1M8 12h1M8 16h1M15 12h2M15 16h2',
  question: 'M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V14M12 18h.01',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M16 11a3 3 0 0 0 0-6M18 20a6 6 0 0 0-3-5.2',
  compare: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  stats: 'M4 20V4M4 20h16M8 16l4-5 3 3 5-6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  briefcase: 'M3 8h18v12H3zM8 8V5h8v3M3 13h18',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
};

export function icon(name, cls = 'icon') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name] || '');
  svg.append(path);
  return svg;
}

// ---------- 日付 ----------

const pad = (n) => String(n).padStart(2, '0');
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** ISO文字列 → "2026/11/01(日) 10:00"（時刻なしの指定も可） */
export function formatDateTime(iso, { time = true } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}(${WEEKDAYS[d.getDay()]})`;
  return time ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

export const formatDate = (iso) => formatDateTime(iso, { time: false });

/** ISO文字列 → datetime-local の値 "2026-11-01T10:00" */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO文字列 → date の値 "2026-11-01" */
export const toDateInput = (iso) => toLocalInput(iso).slice(0, 10);

/** 今日から何日後か（日付単位、過去は負） */
export function daysFromToday(iso, now = new Date()) {
  const d = new Date(iso);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86_400_000);
}

export function relativeDay(iso, now = new Date()) {
  const n = daysFromToday(iso, now);
  if (n === 0) return '今日';
  if (n === 1) return '明日';
  if (n === 2) return 'あさって';
  if (n > 0) return `${n}日後`;
  return `${-n}日前`;
}

// ---------- トースト ----------

/**
 * 画面下部に短いメッセージを表示する。
 * action: { label, onClick } を渡すとボタン付き（「元に戻す」など）
 */
export function showToast(message, { action = null, duration = 3000 } = {}) {
  const area = document.getElementById('toast-area');
  let timer = null;
  const close = () => {
    clearTimeout(timer);
    toast.classList.add('toast-hide');
    setTimeout(() => toast.remove(), 200);
  };
  const toast = h('div', { class: 'toast', role: 'status' },
    h('span', { class: 'toast-message' }, message),
    action && h('button', {
      type: 'button',
      class: 'toast-action',
      onclick: async () => {
        close();
        await action.onClick();
      },
    }, action.label)
  );
  // 表示は常に1件だけにする（古いものは消す）
  area.replaceChildren(toast);
  timer = setTimeout(close, duration);
  return close;
}

export function showError(err) {
  console.error(err);
  showToast(err && err.message ? err.message : 'エラーが発生しました', { duration: 5000 });
}

// ---------- ダイアログ ----------

/**
 * 確認ダイアログ。OK なら true、キャンセルなら false を返す
 * @param {object} opts { title, message, details: string[], okLabel, danger }
 */
export function confirmDialog({ title, message = '', details = [], okLabel = 'OK', cancelLabel = 'キャンセル', danger = false }) {
  const dialog = document.getElementById('dialog');
  return new Promise((resolve) => {
    const finish = (value) => {
      dialog.close();
      resolve(value);
    };
    dialog.replaceChildren(
      h('form', { method: 'dialog', class: 'dialog-body', onsubmit: (e) => e.preventDefault() },
        h('h2', { class: 'dialog-title' }, title),
        message && h('p', { class: 'dialog-message' }, message),
        details.length > 0 && h('ul', { class: 'dialog-details' }, details.map((d) => h('li', {}, d))),
        h('div', { class: 'dialog-actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => finish(false) }, cancelLabel),
          h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => finish(true) }, okLabel)
        )
      )
    );
    dialog.oncancel = (e) => {
      e.preventDefault();
      finish(false);
    };
    dialog.showModal();
  });
}

/**
 * 内容を自由に組み立てるダイアログ（シート）。build(close) が返す要素を表示する
 * @returns {Promise<any>} close(value) に渡した値
 */
export function openSheet(build) {
  const dialog = document.getElementById('dialog');
  return new Promise((resolve) => {
    const close = (value) => {
      dialog.close();
      resolve(value);
    };
    dialog.replaceChildren(h('div', { class: 'dialog-body' }, build(close)));
    dialog.oncancel = (e) => {
      e.preventDefault();
      close(undefined);
    };
    dialog.showModal();
  });
}

// ---------- フォーム部品 ----------

/**
 * ラベル付きの入力欄。errors[name] があればエラー表示する
 * @param {object} o { label, name, value, type, required, placeholder, hint, attrs, options（select用）, rows（textarea用） }
 */
export function field(o) {
  const id = `f-${o.name}`;
  let control;
  const common = { id, name: o.name, required: o.required || null, ...(o.attrs || {}) };
  if (o.type === 'select') {
    control = h('select', common, o.options.map(([value, label]) =>
      h('option', { value, selected: String(o.value ?? '') === String(value) }, label)
    ));
  } else if (o.type === 'textarea') {
    control = h('textarea', { ...common, rows: String(o.rows || 3), placeholder: o.placeholder || null });
    control.value = o.value ?? '';
  } else {
    control = h('input', { ...common, type: o.type || 'text', placeholder: o.placeholder || null });
    control.value = o.value ?? '';
  }
  return h('div', { class: 'field', dataset: { field: o.name } },
    h('label', { for: id }, o.label, o.required && h('span', { class: 'required' }, '必須')),
    control,
    o.hint && h('p', { class: 'field-hint' }, o.hint),
    h('p', { class: 'field-error', id: `${id}-error` })
  );
}

/** フォームのエラー表示を更新する。errors: { 項目名: メッセージ } */
export function showFieldErrors(form, errors = {}) {
  for (const el of form.querySelectorAll('.field')) {
    const msg = errors[el.dataset.field] || '';
    el.classList.toggle('has-error', !!msg);
    const p = el.querySelector('.field-error');
    if (p) p.textContent = msg;
  }
  const first = form.querySelector('.has-error input, .has-error select, .has-error textarea');
  if (first) first.focus();
}

export function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// ---------- 表示部品 ----------

export function emptyState(message, action = null) {
  return h('div', { class: 'empty' }, h('p', {}, message), action);
}

export function section(title, ...children) {
  return h('section', { class: 'section' }, title && h('h2', { class: 'section-title' }, title), ...children);
}

/** 志望度（1〜5）を星で表示する */
export function stars(level) {
  if (!level) return h('span', { class: 'stars muted' }, '志望度 未設定');
  return h('span', { class: 'stars', 'aria-label': `志望度 ${level}` }, '★'.repeat(level) + '☆'.repeat(5 - level));
}

/** 外部リンク（http/https のみ。新しいタブで開き、参照元を送らない） */
export function externalLink(url, label) {
  return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'ext-link' }, label || url);
}
