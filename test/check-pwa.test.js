import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPwa, pngSize, parseServiceWorker } from '../scripts/check-pwa.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** アプリ一式を一時ディレクトリにコピーし、edit(dir) で壊してから検証する */
function checkWith(edit = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pwa-'));
  try {
    for (const p of ['index.html', 'manifest.webmanifest', 'sw.js', 'js', 'css', 'icons']) cpSync(join(ROOT, p), join(dir, p), { recursive: true });
    if (existsSync(join(ROOT, '.pwa-hash'))) cpSync(join(ROOT, '.pwa-hash'), join(dir, '.pwa-hash'));
    edit(dir);
    return checkPwa(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const replaceIn = (dir, file, from, to) => {
  const p = join(dir, file);
  const s = readFileSync(p, 'utf8');
  assert.ok(s.includes(from), `${file} に ${from} がありません`);
  writeFileSync(p, s.replace(from, to));
};

test('現在のリポジトリはすべて合格する', () => {
  const { errors } = checkPwa(ROOT);
  assert.deepEqual(errors, []);
});

test('manifest の必須項目が欠けるとエラー', () => {
  const { errors } = checkWith((d) => replaceIn(d, 'manifest.webmanifest', '"display": "standalone"', '"display": "browser"'));
  assert.ok(errors.some((e) => e.includes('standalone')));
});

test('アイコンの実寸が sizes と違うとエラー', () => {
  const { errors } = checkWith((d) => cpSync(join(d, 'icons/icon-192.png'), join(d, 'icons/icon-512.png')));
  assert.ok(errors.some((e) => e.includes('icon-512.png') && e.includes('192x192')));
});

test('絶対パス・外部CDNへの参照はエラー', () => {
  const { errors } = checkWith((d) => {
    replaceIn(d, 'index.html', 'href="css/style.css"', 'href="/css/style.css"');
    replaceIn(d, 'js/ui.js', "// 画面共通の部品", "import 'https://cdn.example.com/lib.js';\n// 画面共通の部品");
  });
  assert.ok(errors.some((e) => e.includes('相対パスではありません: /css/style.css')));
  assert.ok(errors.some((e) => e.includes('外部URL') && e.includes('cdn.example.com')));
});

test('viewport-fit=cover が無いとエラー', () => {
  const { errors } = checkWith((d) => replaceIn(d, 'index.html', ', viewport-fit=cover', ''));
  assert.ok(errors.some((e) => e.includes('viewport-fit')));
});

test('新しいファイルを PRECACHE に登録し忘れるとエラー', () => {
  const { errors } = checkWith((d) => writeFileSync(join(d, 'js/new-module.js'), 'export {};\n'));
  assert.ok(errors.some((e) => e.includes('PRECACHE に登録されていません: js/new-module.js')));
});

test('APP_VERSION と CACHE_VERSION が違うとエラー', () => {
  const { errors } = checkWith((d) => replaceIn(d, 'sw.js', "CACHE_VERSION = '", "CACHE_VERSION = 'mismatch-"));
  assert.ok(errors.some((e) => e.includes('一致しません')));
});

test('ファイルを変えたのに CACHE_VERSION が同じなら警告', () => {
  const { errors, warnings } = checkWith((d) => replaceIn(d, 'css/style.css', '--radius: 12px;', '--radius: 14px;'));
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('CACHE_VERSION')));
});

test('pngSize / parseServiceWorker', () => {
  assert.deepEqual(pngSize(readFileSync(join(ROOT, 'icons/apple-touch-icon.png'))), { width: 180, height: 180 });
  assert.equal(pngSize(Buffer.from('not png')), null);
  const r = parseServiceWorker("const CACHE_VERSION = 'v9';\nconst PRECACHE = [\n  './',\n  'a.js',\n];");
  assert.deepEqual(r, { version: 'v9', precache: ['./', 'a.js'] });
});
