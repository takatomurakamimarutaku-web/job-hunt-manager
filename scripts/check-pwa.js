// PWA 構成の検証スクリプト
// 使い方: node scripts/check-pwa.js [--update-hash]
//   エラーが1つでもあれば終了コード 1。警告だけなら 0。
//   --update-hash: 現在のファイル内容を .pwa-hash に記録し直す（キャッシュ更新漏れ警告の基準）

import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HASH_FILE = '.pwa-hash';

/** 外部URLとみなさない例外（SVG の名前空間など、通信が発生しないもの） */
const ALLOWED_URL_HOSTS = ['www.w3.org'];

function listFiles(dir, root) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, root));
    else out.push(relative(root, p).split('\\').join('/'));
  }
  return out;
}

/** PNG の IHDR から幅・高さを読む */
export function pngSize(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || !sig.every((b, i) => buf[i] === b)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const isRelative = (p) => !/^([a-z][a-z0-9+.-]*:|\/)/i.test(p);

/** sw.js から CACHE_VERSION と PRECACHE を取り出す */
export function parseServiceWorker(source) {
  const version = source.match(/const\s+CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
  const list = source.match(/const\s+PRECACHE\s*=\s*\[([\s\S]*?)\]/);
  return {
    version: version ? version[1] : null,
    precache: list ? [...list[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]) : null,
  };
}

/** キャッシュ更新漏れの検出に使う、事前キャッシュ対象ファイルのハッシュ（sw.js 自身は除く） */
export function contentHash(root, files) {
  const h = createHash('sha256');
  for (const f of [...files].sort()) {
    const p = f === './' ? 'index.html' : f;
    h.update(f);
    if (existsSync(join(root, p))) h.update(readFileSync(join(root, p)));
  }
  return h.digest('hex');
}

/**
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkPwa(root = DEFAULT_ROOT, { writeHash = false, updateHash = false } = {}) {
  const errors = [];
  const warnings = [];
  const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null);

  // 1. manifest
  const manifestText = read('manifest.webmanifest');
  let manifest = null;
  if (!manifestText) errors.push('manifest.webmanifest がありません');
  else {
    try {
      manifest = JSON.parse(manifestText);
    } catch (e) {
      errors.push(`manifest.webmanifest が JSON として読めません: ${e.message}`);
    }
  }
  if (manifest) {
    if (manifest.name !== 'キャリログ') errors.push('manifest: name が「キャリログ」ではありません');
    if (manifest.short_name !== 'キャリログ') errors.push('manifest: short_name が「キャリログ」ではありません');
    if (manifest.display !== 'standalone') errors.push('manifest: display が standalone ではありません');
    if (manifest.start_url !== './') errors.push('manifest: start_url が "./" ではありません');
    if (manifest.scope !== './') errors.push('manifest: scope が "./" ではありません');
    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
    if (icons.length === 0) errors.push('manifest: icons がありません');
    for (const icon of icons) {
      if (!isRelative(icon.src)) errors.push(`manifest: アイコンのパスが相対パスではありません: ${icon.src}`);
      if (!existsSync(join(root, icon.src))) {
        errors.push(`manifest: アイコンファイルがありません: ${icon.src}`);
        continue;
      }
      if (icon.type === 'image/png') {
        const size = pngSize(readFileSync(join(root, icon.src)));
        if (!size) errors.push(`manifest: PNG として読めません: ${icon.src}`);
        else if (icon.sizes !== `${size.width}x${size.height}`) {
          errors.push(`manifest: ${icon.src} の実寸 ${size.width}x${size.height} が sizes "${icon.sizes}" と一致しません`);
        }
      }
    }
    const pngSizes = icons.filter((i) => i.type === 'image/png').map((i) => i.sizes);
    for (const s of ['192x192', '512x512']) if (!pngSizes.includes(s)) errors.push(`manifest: ${s} の PNG アイコンがありません`);
    if (!icons.some((i) => String(i.purpose || '').split(' ').includes('maskable'))) errors.push('manifest: maskable アイコンがありません');
  }

  // 2. index.html
  const html = read('index.html');
  if (!html) errors.push('index.html がありません');
  else {
    if (!/<link[^>]+rel=["']manifest["'][^>]*href=["']manifest\.webmanifest["']/.test(html)) errors.push('index.html: manifest へのリンクがありません');
    const touch = html.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/);
    if (!touch) errors.push('index.html: apple-touch-icon へのリンクがありません');
    else {
      const size = existsSync(join(root, touch[1])) ? pngSize(readFileSync(join(root, touch[1]))) : null;
      if (!size) errors.push(`index.html: apple-touch-icon のファイルがありません: ${touch[1]}`);
      else if (size.width !== 180 || size.height !== 180) errors.push(`apple-touch-icon が 180x180 ではありません（${size.width}x${size.height}）`);
    }
    if (!/<meta[^>]+name=["']viewport["'][^>]*viewport-fit=cover/.test(html)) errors.push('index.html: viewport に viewport-fit=cover がありません');
    for (const m of html.matchAll(/\s(?:src|href)=["']([^"']+)["']/g)) {
      const p = m[1];
      if (p.startsWith('#')) continue;
      if (!isRelative(p) || p.startsWith('//')) errors.push(`index.html: 相対パスではありません: ${p}`);
      else if (!existsSync(join(root, p.split(/[?#]/)[0]))) errors.push(`index.html: 参照先のファイルがありません: ${p}`);
    }
  }

  // 3. 外部URL・外部CDNへの参照がないこと
  const appFiles = ['index.html', 'manifest.webmanifest', 'sw.js', ...listFiles(join(root, 'js'), root), ...listFiles(join(root, 'css'), root)]
    .filter((f) => /\.(html|js|css|webmanifest)$/.test(f));
  for (const f of appFiles) {
    const src = read(f) || '';
    for (const m of src.matchAll(/(?:https?:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})/gi)) {
      if (!ALLOWED_URL_HOSTS.includes(m[1].toLowerCase())) errors.push(`${f}: 外部URLへの参照があります: ${m[0]}`);
    }
    if (/\.css$/.test(f) && /@import/.test(src)) errors.push(`${f}: @import は使用しないでください`);
  }

  // 4. Service Worker
  const sw = read('sw.js');
  if (!sw) errors.push('sw.js がありません');
  else {
    const { version, precache } = parseServiceWorker(sw);
    if (!version) errors.push('sw.js: CACHE_VERSION が見つかりません');
    if (!precache) errors.push('sw.js: PRECACHE が見つかりません');
    else {
      for (const p of precache) {
        if (!isRelative(p)) errors.push(`sw.js: PRECACHE のパスが相対パスではありません: ${p}`);
        else if (p !== './' && !existsSync(join(root, p))) errors.push(`sw.js: PRECACHE のファイルがありません: ${p}`);
      }
      const required = ['./', 'index.html', 'manifest.webmanifest', ...listFiles(join(root, 'js'), root), ...listFiles(join(root, 'css'), root), ...listFiles(join(root, 'icons'), root)];
      for (const f of required) if (!precache.includes(f)) errors.push(`sw.js: PRECACHE に登録されていません: ${f}`);

      const app = read('js/app.js') || '';
      const appVersion = app.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
      if (!appVersion) errors.push('js/app.js: APP_VERSION が見つかりません');
      else if (version && appVersion[1] !== version) errors.push(`js/app.js の APP_VERSION（${appVersion[1]}）と sw.js の CACHE_VERSION（${version}）が一致しません`);

      // 5. キャッシュ更新漏れの検出
      if (version) {
        const hash = contentHash(root, precache);
        const recordPath = join(root, HASH_FILE);
        const record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : null;
        if (record && record.version === version && record.hash !== hash && !updateHash) {
          warnings.push(`アプリのファイルが変更されていますが、CACHE_VERSION が ${version} のままです。公開前に sw.js の CACHE_VERSION と js/app.js の APP_VERSION を上げてください（開発中で公開しない場合は --update-hash で基準を更新できます）`);
        } else if ((writeHash || updateHash) && (!record || record.version !== version || record.hash !== hash)) {
          writeFileSync(recordPath, `${JSON.stringify({ version, hash }, null, 2)}\n`);
        }
      }
    }
  }

  return { errors, warnings };
}

function main() {
  const updateHash = process.argv.includes('--update-hash');
  const { errors, warnings } = checkPwa(DEFAULT_ROOT, { writeHash: true, updateHash });
  for (const w of warnings) console.warn(`⚠ ${w}`);
  for (const e of errors) console.error(`✗ ${e}`);
  if (errors.length > 0) {
    console.error(`\nPWA チェック: エラー ${errors.length}件`);
    process.exit(1);
  }
  console.log(`✓ PWA チェック: すべて合格${warnings.length ? `（警告 ${warnings.length}件）` : ''}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
