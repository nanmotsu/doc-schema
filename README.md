# 社内システム管理

Markdown ベースの文書管理基盤です。フロントマター（YAML）によるドキュメント種別管理・バリデーションと、独自 DSL を使った HTML / PDF 変換機能を提供します。

---

## 必要環境

- Node.js v18 以降
- VS Code（タスク実行に使用）

## セットアップ

```bash
cd .tools
npm install
```

---

## フォルダ構成

```
.tools/                    # スクリプト・依存パッケージ
  scripts/
    shared/                # 共通モジュール（definitions, logger）
    project/               # プロジェクト管理スクリプト
    document/              # ドキュメント管理スクリプト
      graph/               # ドキュメントグラフ（Webサーバー）
    convert/               # Markdown → HTML / PDF 変換スクリプト
.vscode/
  tasks.json               # VS Code タスク定義
  markdown.code-snippets   # DSL ブロックスニペット（gen_snippets で生成）
000_schema/                # スキーマ・設定ファイル
  document/                # ドキュメント管理スキーマ
    schemas/               # フロントマター JSON Schema（11種別）
    flows.json             # 一括作成フロー定義
    obsidian_template/     # Obsidian / Foam 用テンプレート
  convert/                 # 変換機能設定
    dsl.json               # DSL ブロック定義（HTML変換ルール・スニペット）
    style.json             # CSS 変数値（フォント・色・スペーシング）
    page.json              # PDF ページ設定（用紙・余白）
{番号}_{プロジェクト名}/   # プロジェクトドキュメント
997_*/                     # 図ファイル（draw.io / Excalidraw）
998_*/                     # 共通ナレッジ
999_利用ガイド/            # ドキュメント管理・変換機能の利用ガイド
  README/                  # 作成・編集ガイドライン、ファイル種類一覧
  フォルダ構成/            # プロジェクトフォルダ構成リファレンス
  変換サンプル/            # DSL・変換機能の確認用サンプル
```

> `000_schema`・`997_`・`998_`・`999_` プレフィックスはプロジェクトとして扱われず、スクリプトの対象から除外されます。

---

## VS Code タスク一覧

### プロジェクト管理

| タスク名                                               | 説明                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **プロジェクト: フロントマター検証**                   | 全プロジェクトのフロントマターを JSON Schema で検証し、VS Code の問題パネルに表示します |
| **プロジェクト: フロントマター検証（現在のファイル）** | 現在開いているファイルのみ検証します                                                    |
| **プロジェクト: 新規作成**                             | プロジェクト名を入力すると連番フォルダと標準フォルダ構成を生成します                    |

### ドキュメント管理

| タスク名                                   | 説明                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| **ドキュメント: 新規作成**                 | 対話形式でプロジェクト・種別・タイトルを選択し、ドキュメントを 1 件作成します         |
| **ドキュメント: 一括作成**                 | `flows.json` のフロー定義に基づき、同一タイトルで複数ドキュメントをまとめて作成します |
| **ドキュメント: 一覧**                     | 各ドキュメント種別のファイル数・ステータス別件数一覧を表示します                      |
| **ドキュメント: Obsidianテンプレート生成** | `schemas/*.json` の `body` から Obsidian / Foam 用テンプレートファイルを生成します    |
| **ドキュメント: グラフ（起動）**           | ドキュメント間リンクを可視化する Web サーバーを起動します（port 3333）                |
| **ドキュメント: グラフ（ブラウザで開く）** | `http://localhost:3333` をブラウザで開きます                                          |
| **ドキュメント: グラフ（停止）**           | port 3333 のプロセスを停止します                                                      |

### 変換（Markdown → HTML / PDF）

| タスク名                             | 説明                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------- |
| **変換: HTML生成（現在のファイル）** | 現在開いている `.md` を HTML に変換して同じディレクトリに出力します         |
| **変換: PDF生成（現在のファイル）**  | HTML を経由して PDF に変換して同じディレクトリに出力します                  |
| **変換: スニペット生成**             | `dsl.json` のブロック定義から `.vscode/markdown.code-snippets` を生成します |

---

## ドキュメント種別

| キー               | プレフィックス | 説明                             |
| ------------------ | -------------- | -------------------------------- |
| `source`           | `SRC`          | 情報源（会議メモ・参考資料など） |
| `decision`         | `DEC`          | 決定事項（ADR）                  |
| `requirement`      | `REQ`          | 要件定義                         |
| `spec_external`    | `EXT-SPEC`     | 外部仕様                         |
| `spec_internal`    | `INT-SPEC`     | 内部仕様                         |
| `design_external`  | `EXT-DESIGN`   | 外部設計                         |
| `design_internal`  | `INT-DESIGN`   | 内部設計                         |
| `task_impl`        | `TASK`         | 実装タスク                       |
| `task_test`        | `TEST`         | テストタスク                     |
| `issue`            | `ISSUE`        | 課題・問題                       |
| `trouble_shooting` | `DOC-TS`       | トラブルシュート                 |

---

## プロジェクトフォルダ構成

「プロジェクト: 新規作成」タスクで以下の構造が自動生成されます。

```
{番号}_{プロジェクト名}/
├── docs/
│   ├── 1_setup/
│   ├── 2_deploy/
│   ├── 3_runbook/
│   ├── 4_trouble_shooting/
│   └── 5_assets/{analysis, client, evidence, test}/
├── external/
│   ├── 1_requirements/
│   ├── 2_specifications/
│   ├── 3_designs/
│   ├── 4_glossary/
│   └── 99_change_logs/
└── internal/
    ├── 1_sources/
    ├── 2_decisions/
    ├── 3_tasks/
    ├── 4_issues/
    ├── 5_specs/
    ├── 6_designs/
    └── 7_tests/
```

---

## 変換機能（Markdown → HTML / PDF）

### 独自 DSL ブロック

Markdown 内に `:::ブロック名` で始まり `:::` で終わるブロックを記述できます。ブロック定義は `000_schema/convert/dsl.json` で管理します。

| ブロック名  | 用途                         | 属性               |
| ----------- | ---------------------------- | ------------------ |
| `warning`   | 警告ボックス                 | —                  |
| `center`    | 中央揃え                     | —                  |
| `right`     | 右寄せ                       | —                  |
| `large`     | 大きい文字                   | —                  |
| `red`       | 赤文字                       | —                  |
| `pagebreak` | ページ区切り（PDF用）        | —                  |
| `figure`    | 図（キャプション・連番付き） | `width=` `height=` |
| `table`     | 表（キャプション・連番付き） | —                  |

**図サイズ指定の例：**

```markdown
:::figure width=80%
![alt テキスト](./images/sample.png)
図の説明文
:::
```

サイズ省略時は `dsl.json` の `defaults`（デフォルト: `width=100%`）が適用されます。

### Mermaid ダイアグラム

コードブロックに `mermaid` を指定することでフローチャート・シーケンス図などを描画できます。コードブロック直後の段落はキャプションとして取り込まれ、`figure` ブロックと同様に図番号が自動付与されます。

````markdown
```mermaid
flowchart LR
  A[開始] --> B[処理] --> C[終了]
```
Markdown変換パイプラインのフローチャート
````

- CDN 不要・オフライン完結（ローカルの `mermaid` パッケージを使用）
- 変換後の HTML / PDF は SVG として静的埋め込み済みのため、閲覧環境には依存しない

### スキーマによるカスタマイズ

| ファイル                        | カスタマイズ内容                                                     |
| ------------------------------- | -------------------------------------------------------------------- |
| `000_schema/convert/dsl.json`   | DSL ブロックの HTML 要素・CSS スタイル・デフォルト値・スニペット定義 |
| `000_schema/convert/style.json` | フォントサイズ・フォント種別・色・スペーシング等の CSS 変数値        |
| `000_schema/convert/page.json`  | 用紙サイズ（A4 等）・余白・向き・ヘッダー/フッター・アセットルート   |

#### page.json — ヘッダー・フッター設定

`headerFooter` セクションで PDF のヘッダー・フッターを制御できます。  
`left` / `center` / `right` の 3 箇所にそれぞれ内容を指定します。

```json
"headerFooter": {
    "enabled": true,
    "fontSize": "9px",
    "header": {
        "left":   "社外秘",
        "center": "<span class='title'></span>",
        "right":  "<span class='date'></span>"
    },
    "footer": {
        "left":   "株式会社〇〇",
        "center": "<span class='pageNumber'></span> / <span class='totalPages'></span>",
        "right":  ""
    }
}
```

使用できる特殊タグ：

| タグ                               | 内容                 |
| ---------------------------------- | -------------------- |
| `<span class='pageNumber'></span>` | 現在ページ番号       |
| `<span class='totalPages'></span>` | 総ページ数           |
| `<span class='date'></span>`       | PDF 出力日付         |
| `<span class='title'></span>`      | ドキュメントタイトル |

> **注意**: `enabled: true` にするときはヘッダー・フッター表示領域を確保するため、`margin` の `top` / `bottom` を 15mm 以上に設定してください。

#### page.json — アセットルート設定

`assetsRoot` で画像パスの基点ディレクトリを指定します。設定すると `:::figure` や `![alt](...)` の相対パスがワークスペースルートからの `assetsRoot` を基点に解決されます。

```json
"assetsRoot": "997_作成元データ"
```

空文字または項目を削除した場合は Markdown ファイルと同じディレクトリが基点になります（従来の挙動）。

### サンプルファイル

`999_利用ガイド/変換サンプル/sample.md` に全 DSL ブロックを含むサンプルがあります。

```bash
# HTML 変換
node .tools/scripts/convert/build.mjs "999_利用ガイド/変換サンプル/sample.md" --html-only

# HTML + PDF 変換
node .tools/scripts/convert/build.mjs "999_利用ガイド/変換サンプル/sample.md"
```

または VS Code のタスクから「**変換: HTML生成（現在のファイル）**」「**変換: PDF生成（現在のファイル）**」を実行します。

---

## 依存ライブラリ

| パッケージ                                          | バージョン | ライセンス | 用途                                |
| --------------------------------------------------- | ---------- | ---------- | ----------------------------------- |
| [ajv](https://github.com/ajv-validator/ajv)         | ^8.17.0    | MIT        | フロントマター JSON Schema 検証     |
| [js-yaml](https://github.com/nodeca/js-yaml)        | ^4.1.0     | MIT        | YAML パース                         |
| [marked](https://github.com/markedjs/marked)        | ^12.0.0    | MIT        | Markdown → HTML 変換                |
| [mermaid](https://github.com/mermaid-js/mermaid)    | ^11.0.0    | MIT        | Mermaid ダイアグラム描画（SVG変換） |
| [puppeteer](https://github.com/puppeteer/puppeteer) | ^25.0.0    | Apache-2.0 | HTML → PDF 変換・Mermaid SVG生成    |
| [D3.js](https://github.com/d3/d3)                   | v7 (CDN)   | ISC        | ドキュメントグラフの描画            |

> D3.js は CDN 経由で読み込むため、ドキュメントグラフ機能はオフライン環境では動作しません。

---

## Obsidian / Foam でのタグ

フロントマターのタグは以下の形式で出力されます。

```yaml
tags:
  - DEC
```

`tags: #DEC` のように `#` を付けた形式は YAML でコメント扱いになりタグが消えるため、このリポジトリでは使用していません。

---

## ライセンス

MIT License — Copyright (c) 2026 nanmotsu

