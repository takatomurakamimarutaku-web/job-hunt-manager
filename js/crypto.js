// バックアップの暗号化（Web Crypto API のみ使用）
//
// ファイル形式（.jhbak）:
//   0  4byte  識別子 "JHBK"
//   4  1byte  暗号化形式のバージョン（1）
//   5  4byte  PBKDF2 の反復回数（ビッグエンディアン）
//   9  16byte salt（ランダム）
//   25 12byte iv（ランダム。毎回新しく生成）
//   37 残り    AES-GCM(256bit) の暗号文（末尾16byteは改ざん検知用のタグ）
// ヘッダー（先頭37byte）は AES-GCM の追加認証データに含め、書き換えも検知する。
// パスワードはどこにも保存しない。

export const MAGIC = 'JHBK';
export const CRYPTO_FORMAT_VERSION = 1;
export const DEFAULT_ITERATIONS = 600_000;
export const MIN_ITERATIONS = 100_000;
export const MAX_ITERATIONS = 10_000_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const HEADER_BYTES = 4 + 1 + 4 + SALT_BYTES + IV_BYTES; // 37
const TAG_BYTES = 16;

/** バックアップの読み書きで利用者に見せるエラー。code で種類を判別できる */
export class BackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

const subtle = () => {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new BackupError('unsupported', 'この環境では暗号化機能を使用できません（https で開いているか確認してください）');
  return s;
};

const MAGIC_BYTES = new TextEncoder().encode(MAGIC);

/** 先頭が "JHBK" なら暗号化バックアップ */
export function isEncryptedBackup(bytes) {
  return bytes.length >= MAGIC_BYTES.length && MAGIC_BYTES.every((b, i) => bytes[i] === b);
}

/** ヘッダーを読み取る。形式が不正なら BackupError */
export function parseHeader(bytes) {
  if (!isEncryptedBackup(bytes)) throw new BackupError('not-backup', 'このアプリのバックアップファイルではありません');
  if (bytes.length < HEADER_BYTES + TAG_BYTES) throw new BackupError('corrupted', 'ファイルが壊れています（途中で切れている可能性があります）');
  const version = bytes[4];
  if (version > CRYPTO_FORMAT_VERSION) {
    throw new BackupError('too-new', '新しいバージョンのアプリで作成されたファイルです。アプリを更新してから読み込んでください');
  }
  if (version < 1) throw new BackupError('corrupted', 'ファイルが壊れています');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const iterations = view.getUint32(5);
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new BackupError('corrupted', 'ファイルが壊れています（暗号化の設定値が不正です）');
  }
  return {
    version,
    iterations,
    salt: bytes.slice(9, 9 + SALT_BYTES),
    iv: bytes.slice(9 + SALT_BYTES, HEADER_BYTES),
    header: bytes.slice(0, HEADER_BYTES),
    ciphertext: bytes.slice(HEADER_BYTES),
  };
}

/** パスワードと salt から AES-GCM 256bit の鍵を導出する（PBKDF2-SHA256） */
export async function deriveKey(password, salt, iterations = DEFAULT_ITERATIONS) {
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * バイト列を暗号化して、ヘッダー付きのファイル内容を返す
 * @param {Uint8Array} plain
 * @param {string} password
 * @param {object} [options] { iterations }（テストでは小さい値を使う）
 */
export async function encrypt(plain, password, { iterations = DEFAULT_ITERATIONS } = {}) {
  if (!password) throw new BackupError('no-password', 'パスワードを入力してください');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC_BYTES, 0);
  header[4] = CRYPTO_FORMAT_VERSION;
  new DataView(header.buffer).setUint32(5, iterations);
  header.set(salt, 9);
  header.set(iv, 9 + SALT_BYTES);
  const key = await deriveKey(password, salt, iterations);
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: header }, key, plain));
  const out = new Uint8Array(HEADER_BYTES + cipher.length);
  out.set(header, 0);
  out.set(cipher, HEADER_BYTES);
  return out;
}

/** 暗号化ファイルを復号して元のバイト列を返す */
export async function decrypt(fileBytes, password) {
  const h = parseHeader(fileBytes);
  if (!password) throw new BackupError('no-password', 'パスワードを入力してください');
  const key = await deriveKey(password, h.salt, h.iterations);
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: h.iv, additionalData: h.header }, key, h.ciphertext));
  } catch {
    // AES-GCM ではパスワード違いと改ざん・破損を区別できない
    throw new BackupError('wrong-password', 'パスワードが違うか、ファイルが壊れています');
  }
}

// ---------- Base64（添付ファイルを JSON に含めるため） ----------

export function toBase64(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

export function fromBase64(text) {
  let bin;
  try {
    bin = atob(text);
  } catch {
    throw new BackupError('corrupted', 'ファイルが壊れています（添付ファイルのデータが不正です）');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
