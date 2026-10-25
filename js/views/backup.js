// バックアップと復元：暗号化エクスポート、インポート（追加／置き換え）、保存領域の状態

import { countAll } from '../db.js';
import {
  createBackupFile, readBackupFile, importBackup, markBackedUp, validatePassword, summarizeBackup,
  getStorageStatus, formatBytes, storeLabel, MIN_PASSWORD_LENGTH,
} from '../backup.js';
import { h, icon, section, confirmDialog, showToast, formatDateTime } from '../ui.js';

const COUNT_STORES = ['companies', 'applications', 'events', 'tasks', 'interviews', 'questions', 'documents', 'files', 'contacts'];

function countList(counts) {
  return h('dl', { class: 'info' }, COUNT_STORES.map((s) =>
    h('div', { class: 'info-row' }, h('dt', {}, storeLabel(s)), h('dd', {}, `${counts[s] ?? 0}件`))
  ));
}

function persistText(persisted) {
  if (persisted === true) return '保護されています（ブラウザが自動で削除しません）';
  if (persisted === false) return '保護されていません。ホーム画面に追加して使い、定期的にバックアップしてください';
  return 'この環境では確認できません';
}

/**
 * ファイルを保存させる。iPhone では共有シート（「ファイルに保存」など）、使えない環境ではダウンロード。
 * @returns {Promise<boolean>} 保存操作が完了したか（共有をキャンセルした場合は false）
 */
async function deliverFile({ bytes, fileName, mimeType }) {
  const file = new File([bytes], fileName, { type: mimeType });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return true;
    } catch (err) {
      if (err && err.name === 'AbortError') return false;
      // 共有できなかった場合はダウンロードにする
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}

export async function render(ctx) {
  const [counts, storage] = await Promise.all([countAll(ctx.db), getStorageStatus()]);
  const last = ctx.settings.lastBackupAt;

  // ---------- 状態 ----------
  const lastText = h('dd', {}, last ? formatDateTime(last) : 'まだバックアップしていません');
  const status = h('dl', { class: 'info' },
    h('div', { class: 'info-row' }, h('dt', {}, '最終バックアップ'), lastText),
    h('div', { class: 'info-row' }, h('dt', {}, 'データ保護'), h('dd', {}, persistText(storage.persisted))),
    h('div', { class: 'info-row' }, h('dt', {}, '使用容量'),
      h('dd', {}, storage.usage !== null ? `${formatBytes(storage.usage)}${storage.quota ? `（上限の目安 ${formatBytes(storage.quota)}）` : ''}` : '確認できません'))
  );

  // ---------- バックアップの作成 ----------
  const encryptBox = h('input', { type: 'checkbox', checked: true, id: 'backup-encrypt' });
  const pw1 = h('input', { type: 'password', id: 'backup-pw1', autocomplete: 'new-password' });
  const pw2 = h('input', { type: 'password', id: 'backup-pw2', autocomplete: 'new-password' });
  const pwFields = h('div', { class: 'form-group' },
    h('div', { class: 'field' }, h('label', { for: 'backup-pw1' }, `パスワード（${MIN_PASSWORD_LENGTH}文字以上）`), pw1),
    h('div', { class: 'field' }, h('label', { for: 'backup-pw2' }, 'パスワード（確認）'), pw2),
    h('p', { class: 'notice' }, 'パスワードはアプリに保存されません。パスワードを忘れると、バックアップから復元できなくなります。')
  );
  const plainWarning = h('p', { class: 'notice notice-danger', hidden: true },
    '暗号化しないバックアップは、ファイルを開くだけで誰でも応募先や年収などの内容を読めます。保存先と共有相手に十分注意してください。');
  encryptBox.addEventListener('change', () => {
    pwFields.hidden = !encryptBox.checked;
    plainWarning.hidden = encryptBox.checked;
  });
  const exportError = h('p', { class: 'form-error', role: 'alert' });
  const exportResult = h('div');
  const exportButton = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, icon('doc'), 'バックアップを作成');

  const exportForm = h('form', {
    class: 'form',
    onsubmit: async (e) => {
      e.preventDefault();
      exportError.textContent = '';
      exportResult.replaceChildren();
      const encrypted = encryptBox.checked;
      if (encrypted) {
        const err = validatePassword(pw1.value, pw2.value);
        if (err) {
          exportError.textContent = err;
          return;
        }
      } else {
        const ok = await confirmDialog({
          title: '暗号化せずに保存しますか？',
          message: 'ファイルを開くだけで誰でも内容を読めます。応募先・年収・評価などの機密情報が含まれます。',
          okLabel: '暗号化せずに作成',
          danger: true,
        });
        if (!ok) return;
      }
      exportButton.disabled = true;
      exportButton.lastChild.textContent = encrypted ? '暗号化しています…' : '作成しています…';
      try {
        const file = await createBackupFile(ctx.db, { password: pw1.value, encrypted, appVersion: ctx.appVersion });
        pw1.value = '';
        pw2.value = '';
        // 暗号化に時間がかかると共有シートを開く権限が切れるため、保存はもう一度タップしてもらう
        const saveButton = h('button', {
          type: 'button',
          class: 'btn btn-primary btn-block',
          onclick: async () => {
            try {
              if (await deliverFile(file)) {
                const saved = await markBackedUp(ctx.db);
                ctx.settings.lastBackupAt = saved.lastBackupAt;
                lastText.textContent = formatDateTime(saved.lastBackupAt);
                showToast('バックアップを保存しました');
              }
            } catch (err) {
              exportError.textContent = err.message;
            }
          },
        }, icon('doc'), 'ファイルに保存・共有');
        const total = Object.values(summarizeBackup(file.data)).reduce((a, b) => a + b, 0);
        exportResult.replaceChildren(h('div', { class: 'card backup-ready' },
          h('p', { class: 'list-item-title' }, encrypted ? '暗号化したバックアップを作成しました' : 'バックアップを作成しました（暗号化なし）'),
          h('p', { class: 'list-item-sub' }, `${file.fileName}（${formatBytes(file.bytes.length)}、${total}件のデータ）`),
          h('p', { class: 'muted' }, 'iPhone では共有シートの「ファイルに保存」で iCloud Drive などに保存してください。'),
          saveButton
        ));
      } catch (err) {
        exportError.textContent = err.message;
      } finally {
        exportButton.disabled = false;
        exportButton.lastChild.textContent = 'バックアップを作成';
      }
    },
  },
  h('label', { class: 'toggle' }, encryptBox, 'パスワードで暗号化する（推奨）'),
  pwFields,
  plainWarning,
  exportError,
  exportButton,
  exportResult);

  // ---------- 復元 ----------
  const fileInput = h('input', { type: 'file', id: 'restore-file', accept: '.jhbak,.json,application/json,application/octet-stream' });
  const importError = h('p', { class: 'form-error', role: 'alert' });
  const importStep = h('div', { class: 'form' });
  let fileBytes = null;

  const showPreview = (data) => {
    const summary = summarizeBackup(data);
    const merge = h('input', { type: 'radio', name: 'restore-mode', value: 'merge', checked: true });
    const replace = h('input', { type: 'radio', name: 'restore-mode', value: 'replace' });
    const importButton = h('button', { type: 'button', class: 'btn btn-primary btn-block' }, '取り込む');
    importButton.addEventListener('click', async () => {
      importError.textContent = '';
      const mode = replace.checked ? 'replace' : 'merge';
      if (mode === 'replace') {
        const now = await countAll(ctx.db);
        const ok = await confirmDialog({
          title: '現在のデータを置き換えますか？',
          message: 'この端末のデータはすべて削除され、バックアップの内容に置き換わります。この操作は元に戻せません。',
          details: COUNT_STORES.filter((s) => now[s] > 0).map((s) => `${storeLabel(s)} ${now[s]}件を削除`),
          okLabel: '置き換える',
          danger: true,
        });
        if (!ok) return;
      }
      importButton.disabled = true;
      try {
        const r = await importBackup(ctx.db, data, { mode });
        showToast(mode === 'replace' ? 'バックアップの内容に置き換えました' : `取り込みました（追加 ${r.added}件・更新 ${r.updated}件）`, { duration: 5000 });
        ctx.refresh();
      } catch (err) {
        importButton.disabled = false;
        importError.textContent = `取り込めませんでした。データは変更されていません。（${err.message}）`;
      }
    });
    importStep.replaceChildren(
      h('div', { class: 'card' },
        h('p', { class: 'list-item-title' }, 'バックアップの内容'),
        h('p', { class: 'list-item-sub' }, `作成日時：${formatDateTime(data.exportedAt) || '不明'}`),
        countList(summary)
      ),
      h('div', { class: 'form-group' },
        h('label', { class: 'toggle' }, merge, h('span', {}, '既存データに追加（推奨）', h('small', { class: 'field-hint block' }, '同じデータは更新日時が新しい方を残します'))),
        h('label', { class: 'toggle' }, replace, h('span', {}, '置き換え', h('small', { class: 'field-hint block' }, 'この端末のデータをすべて削除してから取り込みます')))
      ),
      importButton
    );
  };

  const tryRead = async (password = '') => {
    importError.textContent = '';
    try {
      showPreview(await readBackupFile(fileBytes, password));
    } catch (err) {
      if (err.code === 'need-password') {
        const pw = h('input', { type: 'password', id: 'restore-pw', autocomplete: 'current-password' });
        importStep.replaceChildren(h('form', {
          class: 'form-group',
          onsubmit: (e) => { e.preventDefault(); tryRead(pw.value); },
        },
        h('div', { class: 'field' }, h('label', { for: 'restore-pw' }, 'バックアップのパスワード'), pw),
        h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, '読み込む')));
        pw.focus();
      } else {
        importError.textContent = err.message;
      }
    }
  };

  fileInput.addEventListener('change', async () => {
    importStep.replaceChildren();
    importError.textContent = '';
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    fileBytes = new Uint8Array(await file.arrayBuffer());
    await tryRead();
  });

  return {
    title: 'バックアップと復元',
    node: h('div', {},
      section('状態', status),
      section('データの件数', countList(counts)),
      section('バックアップを作成',
        h('p', { class: 'muted' }, '全データ（添付ファイルを含む）を1つのファイルにまとめます。'),
        exportForm),
      section('バックアップから復元',
        h('div', { class: 'field' }, h('label', { for: 'restore-file' }, 'バックアップファイルを選択'), fileInput),
        importError,
        importStep)
    ),
  };
}
