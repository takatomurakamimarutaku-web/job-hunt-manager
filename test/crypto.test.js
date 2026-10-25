import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encrypt, decrypt, parseHeader, isEncryptedBackup, toBase64, fromBase64, BackupError,
  MIN_ITERATIONS, DEFAULT_ITERATIONS, HEADER_BYTES,
} from '../js/crypto.js';

// テストは時間短縮のため反復回数を下限値にする（本番の60万回は1件だけ実行する）
const FAST = { iterations: MIN_ITERATIONS };
const enc = new TextEncoder();
const PLAIN = enc.encode('架空の企業データ {"name":"株式会社サンプル商事"} 🔐');
const isCode = (code) => (err) => err instanceof BackupError && err.code === code;

test('暗号化→復号で元のバイト列と一致する', async () => {
  const file = await encrypt(PLAIN, 'correct horse', FAST);
  assert.ok(isEncryptedBackup(file));
  assert.deepEqual(await decrypt(file, 'correct horse'), PLAIN);
});

test('誤ったパスワードでは復号できない', async () => {
  const file = await encrypt(PLAIN, 'correct horse', FAST);
  await assert.rejects(decrypt(file, 'wrong horse'), isCode('wrong-password'));
  await assert.rejects(decrypt(file, ''), isCode('no-password'));
});

test('同じ入力でも salt・iv・暗号文が毎回変わる', async () => {
  const a = await encrypt(PLAIN, 'password1', FAST);
  const b = await encrypt(PLAIN, 'password1', FAST);
  const ha = parseHeader(a);
  const hb = parseHeader(b);
  assert.notDeepEqual(ha.salt, hb.salt);
  assert.notDeepEqual(ha.iv, hb.iv);
  assert.notDeepEqual(ha.ciphertext, hb.ciphertext);
});

test('ヘッダーの形式：識別子・バージョン・反復回数・salt・iv', async () => {
  const file = await encrypt(PLAIN, 'password1', FAST);
  assert.equal(new TextDecoder().decode(file.slice(0, 4)), 'JHBK');
  const h = parseHeader(file);
  assert.equal(h.version, 1);
  assert.equal(h.iterations, MIN_ITERATIONS);
  assert.equal(h.salt.length, 16);
  assert.equal(h.iv.length, 12);
  assert.equal(file.length, HEADER_BYTES + PLAIN.length + 16);
});

test('本体の改ざんを検知する', async () => {
  const file = await encrypt(PLAIN, 'password1', FAST);
  file[file.length - 1] ^= 0x01;
  await assert.rejects(decrypt(file, 'password1'), isCode('wrong-password'));
});

test('ヘッダー（salt）の書き換えも検知する', async () => {
  const file = await encrypt(PLAIN, 'password1', FAST);
  file[10] ^= 0x01;
  await assert.rejects(decrypt(file, 'password1'), isCode('wrong-password'));
});

test('不正なファイル：識別子違い・短すぎる・未知のバージョン・範囲外の反復回数', async () => {
  const file = await encrypt(PLAIN, 'password1', FAST);
  assert.throws(() => parseHeader(enc.encode('{"format":"x"}')), isCode('not-backup'));
  assert.throws(() => parseHeader(file.slice(0, 30)), isCode('corrupted'));
  const future = file.slice();
  future[4] = 2;
  assert.throws(() => parseHeader(future), isCode('too-new'));
  const huge = file.slice();
  new DataView(huge.buffer).setUint32(5, 0xffffffff);
  assert.throws(() => parseHeader(huge), isCode('corrupted'));
  const tiny = file.slice();
  new DataView(tiny.buffer).setUint32(5, 1);
  assert.throws(() => parseHeader(tiny), isCode('corrupted'));
});

test('Base64：往復で一致する（大きなデータ・空データ）', () => {
  const big = new Uint8Array(200_000).map((_, i) => (i * 31) % 256);
  assert.deepEqual(fromBase64(toBase64(big)), big);
  assert.deepEqual(fromBase64(toBase64(new Uint8Array(0))), new Uint8Array(0));
  assert.throws(() => fromBase64('%%%不正%%%'), isCode('corrupted'));
});

test('本番の反復回数（60万回）でも暗号化→復号できる', async () => {
  const file = await encrypt(PLAIN, 'production-password');
  assert.equal(parseHeader(file).iterations, DEFAULT_ITERATIONS);
  assert.equal(DEFAULT_ITERATIONS, 600_000);
  assert.deepEqual(await decrypt(file, 'production-password'), PLAIN);
});
