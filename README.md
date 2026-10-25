# キャリログ

iPhone で使う転職活動管理アプリ（PWA）です。企業分析・応募状況・選考履歴・タスクを、端末の中だけで一元管理します。

- HTML / CSS / JavaScript（ES Modules）のみで、フレームワークやビルドは使いません
- データは端末内（IndexedDB）にだけ保存し、外部には送信しません。外部CDNも使いません
- オフラインでも起動できます（Service Worker）

> **データの保護について**
> アプリ内のデータは暗号化されていません。保護は iPhone 本体のロック（パスコード・Face ID）に依存します。
> 端末を他人と共有する場合や、ロックを設定していない場合は注意してください。

## 開発状況

| フェーズ | 内容 | 状態 |
| --- | --- | --- |
| Phase 1 | PWA の基盤、企業・応募・選考ステータス | 実装済み |
| Phase 2 | 暗号化バックアップ | 未着手 |
| Phase 3 | タスク管理とカレンダー連携（.ics） | 未着手 |
| Phase 4 | カンバン表示と検索 | 未着手 |
| Phase 5 | 面接記録・質問バンク・応募書類・担当者 | 未着手 |
| Phase 6 | 企業分析と比較 | 未着手 |
| Phase 7 | 統計 | 未着手 |

## 使い方

### iPhone へのインストール

1. Safari で公開URL（例：`https://<ユーザー名>.github.io/job-hunt-manager/`）を開きます
2. 共有ボタン → 「ホーム画面に追加」を選びます
3. ホーム画面の「キャリログ」アイコンから起動します

**必ずホーム画面に追加して使ってください。** Safari のまま使うと、しばらく使わなかった場合にデータが削除されることがあります。また、Safari とホーム画面のアプリはデータの保存場所が別なので、片方で入力したデータはもう片方には表示されません。

### 基本の流れ

1. 下部の「＋」→「企業を追加」で企業を登録します。企業名を入力すると、登録済みの似た名前の企業が表示されます（重複登録の防止）
2. 企業の詳細画面の「応募を追加」で応募を登録します。応募日を入れると、初期ステータスは「書類選考・結果待ち」になります
3. 応募の詳細画面の「ステータス変更」で、段階・状態・日時・場所・オンラインURLを記録します。変更のたびに選考の履歴が残ります
4. ホームに、進行中の応募数と直近の選考予定が表示されます

### 選考ステータスの考え方

ステータスは「段階」と「状態」の組み合わせで表します。

- 段階：興味あり → 応募準備 → 書類選考 → 一次面接 → 二次面接 → 最終面接 → 内定（設定画面で追加・名称変更・並べ替えができます）
- 状態：予定／結果待ち／通過／不合格／辞退／承諾（承諾は内定の段階のみ）
- 例：「書類落ち」＝書類選考＋不合格、「一次面接待ち」＝一次面接＋予定
- 不合格・辞退になった応募は「終了」としてアーカイブ扱いになります

### 削除と「元に戻す」

企業を削除すると、紐づく応募・選考イベント・タスク・面接記録も削除されます（確認ダイアログに件数が表示されます）。担当者は削除されず、企業との紐づけだけが外れます。削除後 5 秒間は「元に戻す」で復元できます。

## ファイル構成

```
index.html              画面の土台（ヘッダー・下部タブ・ダイアログ）
manifest.webmanifest    PWA の設定
sw.js                   Service Worker（オフライン対応・更新）
css/style.css           スタイル（スマホ優先・ダークモード対応）
icons/                  アイコン（scripts/build-icons.js で生成）
js/app.js               起動処理・画面の切り替え・更新通知
js/router.js            ハッシュルーティング
js/db.js                IndexedDB（スキーマ・移行・CRUD・連鎖削除と復元・ホームの集計）
js/status.js            選考ステータスの変更と履歴（changeStatus など）
js/stages.js            段階・状態・応募経路の定数と、段階マスタの編集
js/search.js            検索用の正規化・重複候補の検索
js/validate.js          入力値の検証
js/ui.js                画面共通の部品（ダイアログ・トースト・フォーム）
js/views/               画面ごとの描画処理
scripts/check-pwa.js    PWA 構成の検証
scripts/build-icons.js  アイコン生成
test/                   テスト（node --test）
```

## データ構造

DB 名は `job-hunt`（現在のバージョン：1）。ID は `crypto.randomUUID()` で生成し、日時は UTC の ISO 8601 文字列（例：`2026-11-01T01:00:00.000Z`）で保存します。後のフェーズで使う項目も Phase 1 の時点で定義しています（値は空）。

| ストア | 主な項目 | インデックス |
| --- | --- | --- |
| companies（企業） | id, name, nameKey, industry, url, location, employees, founded, listing, business, strengths, weaknesses, competitors, salaryMin, salaryMax（万円）, workStyle, interestLevel(1〜5), tags[], memo, financials[], sources[], scores{}, createdAt, updatedAt | nameKey, updatedAt |
| applications（応募） | id, companyId, position, channel(direct/agent/referral/scout/other), agentContactId, appliedAt, stage, state, documentIds[], memo, createdAt, updatedAt | companyId, stage, state, updatedAt |
| events（選考イベント＝ステータス履歴） | id, applicationId, stage, state, scheduledAt, endAt, place, onlineUrl, memo, createdAt | applicationId, scheduledAt |
| tasks（タスク） | id, title, dueAt, done(0/1), doneAt, priority, applicationId, companyId, sourceEventId, templateId, memo, createdAt, updatedAt | dueAt, done, applicationId, companyId, sourceEventId |
| taskTemplates | id, trigger{stage, state}, items[{title, offsetDays, base}] | — |
| interviews（面接記録） | id, eventId, applicationId, interviewers, questions[], overallReflection, selfRating, createdAt, updatedAt | applicationId, eventId |
| questions（質問バンク） | id, text, textKey, category, bestAnswer, memo, createdAt, updatedAt | textKey |
| documents（応募書類） | id, type, title, body, version, parentId, fileId, createdAt, updatedAt | type, parentId |
| files | id, name, mimeType, blob | — |
| contacts（担当者） | id, name, nameKey, type, organization, companyId, email, phone, logs[], memo, createdAt, updatedAt | nameKey, companyId |
| settings | key("app"), stages[{id, label, order}], scoreAxes[{id, name, weight}], lastBackupAt | （keyPath: key） |

設計上の補足：

- `tasks.done` は true/false ではなく 0/1 で保存します。IndexedDB は真偽値をインデックスのキーにできないためです
- `tasks.companyId` と `tasks.sourceEventId` にもインデックスを張っています（企業削除時の連鎖削除と、Phase 3 の期日再計算で使うため）
- 名前など検索対象の項目は、保存時に正規化キー（`nameKey` など）を自動生成します。正規化は NFKC → 小文字化 → ひらがなをカタカナに統一 → 空白の整理です
- ステータスの変更は必ず `changeStatus()`（js/status.js）を経由し、応募の現在のステータスの更新と選考イベントの追加を 1 つのトランザクションで行います。応募の登録時も、最初のイベントを同じトランザクションで作成します。これにより「最新のイベント＝現在のステータス」が常に成り立ちます

### スキーマを変更するとき

1. `js/db.js` の `DB_VERSION` を 1 つ上げます
2. `MIGRATIONS` に新しいバージョン番号の関数を追加します（既存の関数は変更しません）
3. `test/db.test.js` に「旧バージョンの DB を作ってから開き直す」テストを追加します

## テスト方法

Node.js 20 以上が必要です。

```sh
npm install        # テスト用の fake-indexeddb をインストール（初回のみ）
npm test           # 全テスト（node --test）
node scripts/check-pwa.js   # PWA 構成の検証
```

`check-pwa.js` は次の項目を検証し、エラーがあれば終了コード 1 を返します。

- manifest の必須項目（name、short_name、display: standalone、start_url・scope が `./`）
- アイコンの存在と、PNG の実寸が manifest の sizes と一致すること（maskable、180px の apple-touch-icon を含む）
- index.html の manifest・apple-touch-icon へのリンクと `viewport-fit=cover`
- すべての参照が相対パスであること、外部 URL・外部 CDN への参照がないこと
- sw.js の PRECACHE に、アプリの全ファイル（js/、css/、icons/ 配下）が登録されていること
- js/app.js の `APP_VERSION` と sw.js の `CACHE_VERSION` が一致すること
- 警告：アプリのファイルを変えたのに `CACHE_VERSION` が前回と同じ場合（`.pwa-hash` と比較）

## GitHub Pages での公開手順

1. GitHub のリポジトリで **Settings → Pages** を開きます
2. 「Build and deployment」の Source で **Deploy from a branch** を選びます
3. Branch で **main**、フォルダで **/(root)** を選び、Save を押します
4. 数分後、`https://<ユーザー名>.github.io/job-hunt-manager/` で公開されます

- パスはすべて相対パスにしているため、サブパス（`/job-hunt-manager/`）でもそのまま動作します
- 無料プランでは、GitHub Pages を使えるのは Public リポジトリだけです。リポジトリにはサンプル（架空の企業）以外のデータは含まれず、入力したデータは端末内にだけ保存されるため、Public でも入力内容が公開されることはありません

## キャッシュの更新手順（ファイルを変更したとき）

Service Worker はアプリのファイルを端末にキャッシュするため、**ファイルを変更したら必ずキャッシュのバージョンを上げてください。** 上げないと、利用者の端末では古いファイルが使われ続けます。

1. `sw.js` の `CACHE_VERSION` を上げます（例：`'v1'` → `'v2'`）
2. `js/app.js` の `APP_VERSION` も同じ値にします
3. ファイルを追加・削除した場合は、`sw.js` の `PRECACHE` の一覧も更新します
4. `node scripts/check-pwa.js` を実行して、エラーがないことを確認します（`.pwa-hash` が更新されるので一緒にコミットします）
5. コミットして main に反映します

利用者の端末では、次にアプリを開いたとき（または前面に戻したとき）に「新しいバージョンがあります［更新］」が表示され、［更新］を押すと切り替わります。入力中の画面が突然切り替わらないよう、自動では切り替えません。

開発中で公開しない変更のときに警告を消したい場合は、`node scripts/check-pwa.js --update-hash` で基準を更新できます。

## アイコンの生成方法

アイコンは `scripts/build-icons.js` の図形定義（角丸四角形と線分のみ）から、SVG と PNG を同時に生成しています。外部ライブラリは使いません。

```sh
node scripts/build-icons.js
```

| ファイル | 用途 |
| --- | --- |
| icons/icon.svg | ブラウザのタブ・manifest（SVG） |
| icons/icon-maskable.svg | maskable 版の SVG（参考） |
| icons/apple-touch-icon.png | iPhone のホーム画面（180×180。iOS が角丸に切り抜くため全面塗り） |
| icons/icon-192.png / icon-512.png | manifest（角丸、周囲は透明） |
| icons/icon-maskable-512.png | manifest の maskable（全面塗り、図柄は中央 80% に収める） |

図柄を変えるときは `CONTENT` の座標（512×512 基準）を編集して再生成し、キャッシュのバージョンを上げてください。別の方法で SVG から PNG を作る場合は、`rsvg-convert -w 180 -h 180 icons/icon.svg -o icons/apple-touch-icon.png`（librsvg）や、ブラウザで SVG を開いてスクリーンショットを撮る方法もあります。

## 機密情報の取り扱い

- リポジトリには実在の企業名や個人情報を含むデータをコミットしないでください。テストのサンプルデータは架空の企業・人物のみです
- `.gitignore` でバックアップファイル（`*.jhbak`、`backup*.json`）を除外しています

## ライセンス

| ライブラリ | 用途 | ライセンス |
| --- | --- | --- |
| [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB) | テスト専用（devDependency。アプリ本体には含まれません） | Apache-2.0 |

アプリ本体は外部ライブラリを使用していません。画像・アイコンはすべて自作です。
