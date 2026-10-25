// 起動処理：DBを開く → 設定を用意 → Service Worker を登録 → ルーティング開始

import { openDB, ensureSettings, getSettings } from './db.js';
import { startRouter, goBack, navigate, refresh } from './router.js';
import { showError } from './ui.js';
import { requestPersistence } from './backup.js';
import * as home from './views/home.js';
import * as companies from './views/companies.js';
import * as companyForm from './views/company-form.js';
import * as companyDetail from './views/company-detail.js';
import * as applicationForm from './views/application-form.js';
import * as applicationDetail from './views/application-detail.js';
import * as board from './views/board.js';
import * as add from './views/add.js';
import * as more from './views/more.js';
import * as settings from './views/settings.js';
import * as backup from './views/backup.js';
import * as placeholder from './views/placeholder.js';

/** アプリのバージョン。sw.js の CACHE_VERSION と同じ値にする（check-pwa.js で検証） */
export const APP_VERSION = 'v3';

const VIEWS = {
  home, companies, board, add, more, settings, backup,
  companyNew: companyForm,
  companyEdit: companyForm,
  company: companyDetail,
  applicationNew: applicationForm,
  applicationEdit: applicationForm,
  application: applicationDetail,
  tasks: placeholder,
  questions: placeholder,
  documents: placeholder,
  contacts: placeholder,
  compare: placeholder,
  stats: placeholder,
  notFound: placeholder,
};

/** 下部タブ直下の画面（戻るボタンを出さない） */
const TOP_LEVEL = new Set(['home', 'board', 'add', 'tasks', 'more']);

/** どのタブを選択状態にするか */
const TAB_OF = {
  home: 'home', board: 'board', add: 'add', tasks: 'tasks',
  application: 'board', applicationEdit: 'board', applicationNew: 'add', companyNew: 'add',
};

/** アプリ内に戻る先が無い場合（直接開いた場合など）の戻り先 */
function fallbackOf(route) {
  switch (route.name) {
    case 'companyEdit': return `/company/${encodeURIComponent(route.params.id)}`;
    case 'applicationEdit': return `/application/${encodeURIComponent(route.params.id)}`;
    case 'company': return '/companies';
    case 'application': return '/board';
    case 'backup': return '/settings';
    case 'companies': case 'settings': case 'questions': case 'documents':
    case 'contacts': case 'compare': case 'stats': return '/more';
    default: return '/home';
  }
}

const els = {};
let db = null;
let currentRoute = null;
let renderToken = 0;
let cleanup = null;

async function renderRoute(route) {
  currentRoute = route;
  const token = ++renderToken;
  const view = VIEWS[route.name] || placeholder;
  try {
    if (typeof cleanup === 'function') cleanup();
    cleanup = null;
    const ctx = {
      db,
      route,
      settings: await getSettings(db),
      appVersion: APP_VERSION,
      navigate,
      refresh,
      goBack: () => goBack(fallbackOf(route)),
    };
    const result = await view.render(ctx);
    if (token !== renderToken) return; // より新しい画面遷移があった
    els.title.textContent = result.title || 'キャリログ';
    document.title = result.title ? `${result.title} - キャリログ` : 'キャリログ';
    els.headerAction.replaceChildren(...(result.headerActions || []));
    els.back.hidden = TOP_LEVEL.has(route.name);
    els.main.classList.toggle('has-actions', !!result.hasActions);
    els.main.replaceChildren(result.node);
    cleanup = result.cleanup || null;
    const tab = TAB_OF[route.name] || 'more';
    for (const a of document.querySelectorAll('.tab')) {
      const active = a.dataset.tab === tab;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    window.scrollTo(0, 0);
  } catch (err) {
    if (token !== renderToken) return;
    showError(err);
    els.main.textContent = `画面を表示できませんでした：${err.message}`;
  }
}

// ---------- Service Worker と更新通知 ----------

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let updateRequested = false;
  const reg = await navigator.serviceWorker.register('./sw.js');

  const showBanner = () => {
    // 初回インストール時（まだ制御されていない）は表示しない
    if (!reg.waiting || !navigator.serviceWorker.controller) return;
    els.updateBanner.hidden = false;
  };
  els.updateButton.addEventListener('click', () => {
    if (!reg.waiting) return;
    updateRequested = true;
    els.updateButton.disabled = true;
    reg.waiting.postMessage('SKIP_WAITING');
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateRequested) location.reload();
  });
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') showBanner();
    });
  });
  showBanner();
  // iPhone ではアプリを開き直しても更新確認が走りにくいため、前面に戻ったときに確認する
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => {});
  });
}

// ---------- 起動 ----------

async function boot() {
  els.main = document.getElementById('app');
  els.title = document.getElementById('page-title');
  els.back = document.getElementById('back-button');
  els.headerAction = document.getElementById('header-action');
  els.updateBanner = document.getElementById('update-banner');
  els.updateButton = document.getElementById('update-button');
  els.back.addEventListener('click', () => goBack(currentRoute ? fallbackOf(currentRoute) : '/home'));

  try {
    db = await openDB();
    await ensureSettings(db);
    // ブラウザが容量不足時にデータを自動削除しないよう保護を求める（対応環境のみ。結果はバックアップ画面に表示）
    requestPersistence().catch(() => {});
  } catch (err) {
    els.main.textContent = `データベースを開けませんでした：${err.message}`;
    return;
  }
  startRouter(renderRoute);
  registerServiceWorker().catch((err) => console.warn('Service Worker を登録できませんでした', err));
}

boot();
