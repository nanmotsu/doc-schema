# 社内システム管理

この README は機能別 README の入口です。

## 1. 機能別 README

- プロジェクト管理とフェーズ運用: [README_Project.md](README_Project.md)
- プロジェクト管理スクリプト詳細: [README_ProjectManagement.md](README_ProjectManagement.md)
- ドキュメント管理（作成/一括/一覧）: [README_DocumentManagement.md](README_DocumentManagement.md)
- 変換機能（HTML/PDF/Word）: [README_Convert.md](README_Convert.md)
- テスト仕様の Excel 化: [README_TestExcel.md](README_TestExcel.md)
- Word 変換の深掘りメモ: [README_WORD.md](README_WORD.md)
- 利用ガイド（統合ガイドライン）: [999_利用ガイド/ガイドライン/README.md](999_利用ガイド/ガイドライン/README.md)
- 利用ガイド（フォルダ構成）: [999_利用ガイド/フォルダ構成/README.md](999_利用ガイド/フォルダ構成/README.md)

## 2. 最低限セットアップ

```bash
cd .tools
npm install
npx puppeteer browsers install chrome
```

## 3. よく使うタスク

- プロジェクト: フロントマター検証
- プロジェクト: 新規作成
- ドキュメント: 新規作成
- ドキュメント: 一括作成
- 変換: PDF生成（現在のファイル）
- テスト: Excel生成（現在のフォルダ）

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

## テスト仕様書機能（YAML → Excel）

`external/5_test_specs/` 以下の YAML ファイルを読み込み、テスト仕様書 Excel（`.xlsx`）を生成します。

### outputDir（必須）

`TEST-*.yaml` には `outputDir` を必ず指定してください。

- 相対パス / 絶対パスのどちらも指定可能
- 相対パスは各 YAML ファイルの配置ディレクトリ基準で解決
- 存在しないディレクトリを指定した場合、`validate.mjs` でエラー

```yaml
id: TEST-001
title: ログイン機能テスト仕様書（正常系）
version: "1.0"
date: "2026-05-19"
author: 担当者名
outputDir: ./output
```

### ファイル構成

```
5_test_specs/
├── preconditions.yaml          # 全ケース共通の前提条件・実行環境・事前データ
├── TEST-001_*.yaml             # テスト仕様（複数配置可）
├── TEST-002_*.yaml
└── output/
    └── テスト仕様書_yyyyMMddHHmmss.xlsx   # 生成結果（タイムスタンプ付き・上書きしない）
```

### Excel 構成

| シート        | 内容                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| ①共通前提条件 | `preconditions.yaml` の前提条件・実行環境・事前データ                         |
| ②〜（各仕様） | `TEST-*.yaml` ごとに 1 シート。上部に前提条件・事前データ、下部にステップ一覧 |

### 列のカスタマイズ

`000_schema/test/excel_columns.json` の `enabled` を `false` にすると列を非表示にできます。

```json
{ "key": "evShot", "header": "スクリーンショット", "width": 26, "enabled": false }
```

### テスト仕様グリッド（Ctrl+V 反映）

`TEST-*.yaml` を表形式で編集し、`Ctrl+V` / ファイル選択で貼り付けた画像を `evidence.screenshot` に反映できます。

- 起動: `node .tools/scripts/test/grid/grid.mjs [specDir]`
- URL: `http://localhost:3344`
- `outputDir` は YAML ごとに設定（Excel のシート単位イメージ）
- `outputDir` のUI変更値は YAML 本体ではなく `.tools/scripts/test/grid/grid_output_dirs.json` に保存
- `outputDir` 未指定・存在しない場合は API 側でエラー
- 画面上部は YAML ファイルごとのタブ表示（件数付き）
- ケース区切り見出しは `TC-001 タイトル` 形式で表示
- 画像列の上部に `evidence.memo` 入力欄を表示（改行可・自動保存）
- `evidence.memo` 入力欄は初期 2 行で、入力量に応じて自動で縦に拡張
- 判定（pass / fail / pending / not_run）・備考・実施日・実施者を行ごとに自動保存
- 画像の行削除は「参照解除のみ」（実ファイルは削除しない）
- 未参照画像の一括クリーンアップ（候補プレビュー + 確認モーダル）に対応

```bash
node .tools/scripts/test/grid/grid.mjs "999_利用ガイド/テスト結果サンプル"
```

### evidence 仕様（現行）

`evidence` は以下のみを扱います。

- `screenshot`: 文字列または配列（複数画像対応）
- `memo`: 文字列（改行可）


```yaml
evidence:
  screenshot:
    - TEST-001-TC001-S01_1780087323824_87753015.png
  memo: |
    ○○であることを確認

    ○○が確認できた。
```

### 証跡シート（Excel）

- 証跡シートでは各ステップを `No.x` で区切って出力
- `evidence.memo` は画像より前に出力
- 画像がない場合の「画像なし」固定文言は出力しない

### YAML スニペット

`.vscode/test_spec.code-snippets` に登録済みです。YAML ファイル内で以下のプレフィックスを入力すると補完されます。

| プレフィックス | 内容                                 |
| -------------- | ------------------------------------ |
| `tspec`        | ファイルヘッダー（`id` ～ `cases:`） |
| `tc`           | テストケース 1 件                    |
| `step`         | ステップ・エビデンス（通常）         |
| `step-auto`    | ステップ・エビデンス（互換）         |
| `step-none`    | ステップ・エビデンスなし             |

サンプルファイルは `999_利用ガイド/テスト結果サンプル/` にあります。

---

## 依存ライブラリ

| パッケージ                                          | バージョン | ライセンス | 用途                                |
| --------------------------------------------------- | ---------- | ---------- | ----------------------------------- |
| [ajv](https://github.com/ajv-validator/ajv)         | ^8.17.0    | MIT        | フロントマター JSON Schema 検証     |
| [exceljs](https://github.com/exceljs/exceljs)       | ^4.4.0     | MIT        | テスト仕様書 Excel ファイル生成     |
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

