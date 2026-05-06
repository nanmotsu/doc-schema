# doc-schema

Markdown ドキュメントをフロントマター（YAML）で管理するためのスキーマ・スクリプト群です。 
以下で使用可能です 
‐ [Obsidian](https://obsidian.md/) 
- [Foam](https://foambubble.github.io/foam/) 
- 内部実装アプリ(000_schema\scripts\graph 内)

## 特徴

- **スキーマ駆動** — `schemas/*.json` にドキュメント種別の定義を集約。ID パターン・ステータス・テンプレートをひとつのファイルで管理します。
- **Obsidian / Foam 対応** — フロントマターの `tags` は YAML 正式形式（`- TAG`）で出力するため、どちらのツールでもタグが正しく認識されます。
- **VS Code タスク統合** — よく使う操作をすべて VS Code の「タスクの実行」から呼び出せます。

## 必要環境

- Node.js v18 以降
- VS Code（タスク実行に使用）

## セットアップ

```bash
cd 000_schema
npm install
```

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

## VS Code タスク一覧

| タスク名                                 | スクリプト                   | 説明                                                                                    |
| ---------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| **フロントマター検証**                   | `validate.mjs`               | 全プロジェクトのフロントマターを JSON Schema で検証し、VS Code の問題パネルに表示します |
| **フロントマター検証（現在のファイル）** | `validate.mjs <file>`        | 現在開いているファイルのみ検証します                                                    |
| **ドキュメント新規作成**                 | `create.mjs`                 | 対話形式でプロジェクト・種別・タイトルを選択し、ドキュメントを 1 件作成します           |
| **ドキュメント一括作成**                 | `batch.mjs`                  | `flows.json` のフロー定義に基づき、同一タイトルで複数ドキュメントをまとめて作成します   |
| **ドキュメント一覧**                     | `list.mjs`                   | 各ドキュメント種別のファイル数・ステータス別の件数一覧を表示します                      |
| **プロジェクト新規作成**                 | `new_project.mjs`            | プロジェクト名を入力すると連番フォルダと標準フォルダ構成を生成します                    |
| **Obsidianテンプレート生成**             | `gen_obsidian_templates.mjs` | `schemas/*.json` の `body` から Obsidian / Foam 用テンプレートファイルを生成します      |
| **ドキュメントグラフ（サーバー）**       | `graph/graph.mjs`            | ドキュメント間のリンクを可視化する Web サーバーを起動します（port 3333）                |
| **ドキュメントグラフ（ブラウザで開く）** | —                            | `http://localhost:3333` をブラウザで開きます                                            |
| **ドキュメントグラフ（サーバー停止）**   | —                            | port 3333 のプロセスを停止します                                                        |

## フォルダ構成

プロジェクトフォルダは「プロジェクト新規作成」タスクで以下の構造が自動生成されます。

### 予約フォルダ

| フォルダ      | 用途                                                         |
| ------------- | ------------------------------------------------------------ |
| `000_schema/` | スキーマ定義・スクリプト群（本リポジトリ）                   |
| `997_*/`      | draw.io・Excalidraw などの図ファイル（VS Code で作成・編集） |
| `998_*/`      | プロジェクトに依存しない共通ナレッジ                         |
| `999_*/`      | 作業ガイドライン・フォルダ構成の説明                         |

これらのプレフィックスはプロジェクトとして扱われず、スクリプトの対象から除外されます。

### プロジェクトフォルダ構成

プロジェクトフォルダは「プロジェクト新規作成」タスクで以下の構造が自動生成されます。

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

## Obsidian / Foam でのタグ

フロントマターのタグは以下の形式で出力されます。

```yaml
tags:
  - DEC
```

`tags: #DEC` のように `#` を付けた形式は YAML でコメント扱いになりタグが消えるため、このリポジトリでは使用していません。

## 依存ライブラリ

| パッケージ                                   | バージョン | ライセンス | 用途                                 |
| -------------------------------------------- | ---------- | ---------- | ------------------------------------ |
| [ajv](https://github.com/ajv-validator/ajv)  | ^8.17.0    | MIT        | フロントマター JSON Schema 検証      |
| [js-yaml](https://github.com/nodeca/js-yaml) | ^4.1.0     | MIT        | YAML パース                          |
| [D3.js](https://github.com/d3/d3)            | v7 (CDN)   | ISC        | ドキュメントグラフの描画             |
| [marked](https://github.com/markedjs/marked) | v9 (CDN)   | MIT        | グラフ画面内の Markdown レンダリング |

> **注意:** D3.js と marked は CDN（インターネット経由）で読み込んでいます。  
> ドキュメントグラフ機能はオフライン環境では動作しません。

## ライセンス

MIT License — Copyright (c) 2026 nanmotsu
