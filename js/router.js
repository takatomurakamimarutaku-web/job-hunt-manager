// ハッシュルーティング
// 画面遷移はすべてブラウザの履歴（location.hash）で行うため、
// アプリ内の戻るボタンと iPhone のスワイプでの戻る操作が同じ動きになる。

/** ルート定義（上から順に照合する）。:name はパラメータ */
export const ROUTES = Object.freeze([
  { name: 'home', path: '/home' },
  { name: 'companies', path: '/companies' },
  { name: 'companyNew', path: '/company/new' },
  { name: 'companyEdit', path: '/company/:id/edit' },
  { name: 'company', path: '/company/:id' },
  { name: 'applicationNew', path: '/application/new' },
  { name: 'applicationEdit', path: '/application/:id/edit' },
  { name: 'application', path: '/application/:id' },
  { name: 'board', path: '/board' },
  { name: 'add', path: '/add' },
  { name: 'tasks', path: '/tasks' },
  { name: 'questions', path: '/questions' },
  { name: 'documents', path: '/documents' },
  { name: 'contacts', path: '/contacts' },
  { name: 'compare', path: '/compare' },
  { name: 'stats', path: '/stats' },
  { name: 'more', path: '/more' },
  { name: 'settings', path: '/settings' },
]);

export const DEFAULT_PATH = '/home';

/**
 * "#/company/abc?tab=1" → { name: 'company', params: { id: 'abc' }, query: { tab: '1' }, path: '/company/abc' }
 * 空のハッシュはホーム、該当しないパスは name: 'notFound'
 */
export function parseHash(hash, routes = ROUTES) {
  let raw = String(hash || '').replace(/^#/, '');
  if (raw === '' || raw === '/') raw = DEFAULT_PATH;
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  const segments = path.split('/').filter(Boolean);
  for (const route of routes) {
    const pattern = route.path.split('/').filter(Boolean);
    if (pattern.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i].startsWith(':')) {
        try {
          params[pattern[i].slice(1)] = decodeURIComponent(segments[i]);
        } catch {
          ok = false;
          break;
        }
      } else if (pattern[i] !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { name: route.name, params, query, path };
  }
  return { name: 'notFound', params: {}, query, path };
}

/** ルート名とパラメータからハッシュを作る */
export function buildHash(path, query = null) {
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  return `#${path}${qs ? `?${qs}` : ''}`;
}

// ---------- ブラウザ側 ----------
// 履歴の各エントリに { idx }（アプリ内で何番目の画面か）を持たせ、
// 「戻る先がアプリ内にあるか」を判定する。スワイプでの戻るは popstate で受け取る。

let onRouteHandler = null;
let lastIdx = 0;
let lastRendered = null;

function render() {
  lastRendered = location.hash;
  onRouteHandler(parseHash(location.hash));
}

function onPop(e) {
  // リンク（<a href="#/...">）での遷移は state が無いので、ここで番号を振る
  if (e.type === 'hashchange' && location.hash === lastRendered) return;
  if (!history.state || typeof history.state.idx !== 'number') {
    history.replaceState({ idx: lastIdx + 1 }, '', location.hash);
  }
  lastIdx = history.state.idx;
  render();
}

/** ルーターを開始する。画面が変わるたびに onRoute(route) を呼ぶ */
export function startRouter(onRoute) {
  onRouteHandler = onRoute;
  const hash = location.hash && location.hash !== '#' ? location.hash : buildHash(DEFAULT_PATH);
  const idx = history.state && typeof history.state.idx === 'number' ? history.state.idx : 0;
  history.replaceState({ idx }, '', hash);
  lastIdx = idx;
  window.addEventListener('popstate', onPop);
  window.addEventListener('hashchange', onPop);
  render();
}

/** 画面を進める。replace: true のときは履歴を積まない（保存後にフォームへ戻らないようにする） */
export function navigate(path, { replace = false } = {}) {
  const hash = path.startsWith('#') ? path : `#${path}`;
  if (replace) {
    history.replaceState({ idx: lastIdx }, '', hash);
  } else {
    lastIdx += 1;
    history.pushState({ idx: lastIdx }, '', hash);
  }
  render();
}

/** アプリ内の戻るボタン。アプリ内に戻る先が無ければ fallback（既定はホーム）へ置き換える */
export function goBack(fallback = DEFAULT_PATH) {
  if (lastIdx > 0) history.back();
  else navigate(fallback, { replace: true });
}

/** 現在の画面を再描画する（データ更新後など） */
export function refresh() {
  if (onRouteHandler) render();
}
