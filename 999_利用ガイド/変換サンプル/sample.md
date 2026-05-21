---
title: 変換機能サンプル
subtitle: Markdown → HTML / PDF 変換 全要素確認用
cover: sample.png
coverOrigin: internal
assetsInternal: "999_利用ガイド/変換サンプル/assets"
assetsExternal: "https://example.com/images"
revisionHistory:
  - version: "1.0"
    date: "2026-05-01"
    author: 田中
    description: 初版作成
  - version: "1.1"
    date: "2026-05-17"
    author: 鈴木
    description: |
      Mermaidダイアグラム対応を追加
      改訂履歴ページを追加
# titlePage: false           # 表題ページを非表示にする場合
# revisionHistoryPage: false # 改訂履歴ページを非表示にする場合（revisionHistoryのデータは残る）
# toc: false                 # 目次を非表示にする場合
---

# 変換機能サンプル

本ドキュメントは **Markdown → HTML / PDF 変換機能** の全要素をひとつのファイルで確認するためのサンプルです。

---

# 見出しの自動番号

見出しには自動で番号が付与されます（`style.json` の `heading.numbering` で制御）。

## サブセクション

### さらに深いセクション

本文テキストです。`inline code` もこのように表示されます。

単一改行はスペース扱いになります（段落は変わらない）。
この行は上の行と同じ段落です。

行末に `\` で改行できます。\
ここから新しい行になります。

行末に半角スペース2つでも同じ効果です。  
ここから新しい行になります。

空行を挟むと段落が分かれます。

---

# 基本テキスト要素

## リスト

- 箇条書き1
- 箇条書き2
  - ネスト1
  - ネスト2
- 箇条書き3

## 番号付きリスト

1. 手順1
2. 手順2
3. 手順3

## 引用

> これは引用テキストです。
> 複数行にまたがることもできます。

## 区切り線

---

## リンクと強調

**太字テキスト**、*斜体テキスト*、~~打ち消し線~~

---

# コードブロック

インライン: `const x = 42;`

ブロック:

```javascript
// JavaScriptのサンプル
function greet(name) {
    return `Hello, ${name}!`;
}

console.log(greet("World"));
```

```bash
# シェルコマンド
node .tools/scripts/convert/build.mjs input.md
```

---


# Mermaidグラフ

` ```mermaid ` コードブロックの直後にキャプション行を書くと「図」として図番号・キャプション付きで出力されます。

## フローチャート（図番号・キャプション付き）

```mermaid
flowchart LR
    A[ファイル読み込み] --> B{フロントマター?}
    B -->|あり| C[メタ情報を解析]
    B -->|なし| D[本文をそのまま使用]
    C --> E[Markdown → HTML]
    D --> E
    E --> F[PDF出力]
```
Markdown変換パイプラインのフローチャート

## シーケンス図（図番号・キャプション付き）

```mermaid
sequenceDiagram
    actor ユーザー
    participant ブラウザ
    participant サーバー
    participant DB
    ユーザー->>ブラウザ: ログイン要求
    ブラウザ->>サーバー: POST /login
    サーバー->>DB: ユーザー検索
    DB-->>サーバー: ユーザー情報
    サーバー-->>ブラウザ: JWT トークン
    ブラウザ-->>ユーザー: ダッシュボード表示
```
ログイン処理のシーケンス図

## キャプションなし（図番号のみ）

```mermaid
flowchart TD
    X --> Y
```

---

# テーブル（標準Markdown）

| ID  | 名前     | 役割         | ステータス |
| --- | -------- | ------------ | ---------- |
| 001 | 山田太郎 | 管理者       | 有効       |
| 002 | 鈴木花子 | 一般ユーザー | 有効       |
| 003 | 田中一郎 | 閲覧者       | 無効       |

---

# 独自DSL ブロック

以下は `000_schema/convert/dsl.json` で定義されたブロックです。

## warning（警告）

デフォルト（`style.json` の `warningMaxWidth` が適用される）:

:::warning
この操作は元に戻せません。実行前に必ずバックアップを取得してください。
:::

幅を指定する場合は `width=` 属性で上書き可能。`style.json` の設定値:
- `warningMaxWidth` — 最大幅（デフォルト `100%`）
- `colors.warningBg` — 背景色
- `colors.warningBorder` — 左ボーダー色
- `spacing` 系は `dsl.json` の `padding` / `margin` で直接調整

幅 60% 指定:

:::warning width=60%
幅を 60% に絞ったwarningブロックです。
:::

幅 40em 指定:

:::warning width=40em
固定幅（40em）のwarningブロックです。短いテキストでも枠が広がりすぎません。
:::

## center（中央揃え）

:::center
**中央に配置されたテキストです**
:::

## right（右寄せ）

:::right
作成日：2026年5月17日
:::

## large（大きい文字）

:::large
重要なお知らせ
:::

## red（赤文字）

:::red
**エラー：** 接続がタイムアウトしました。
:::

## figure（図 — internal起点・デフォルトサイズ）
`origin=internal` を指定すると、`assetsInternal` に定義したフォルダを起点にパスを解決します。
:::figure origin=internal
![サンプル図](sample.png)
システム構成の概要図
:::

## figure（図 — internal起点・幅指定）
:::figure width=60% origin=internal
![幅60%で表示](sample.png)
幅を60%に指定した図
:::

ピクセル指定も可能です。
:::figure width=400px height=300px origin=internal
![ピクセル指定](sample.png)
400×300px 指定の図
:::

## figure（図 — external起点）
`origin=external` を指定すると、`assetsExternal` に定義したベースURL/パスを起点にパスを解決します。
HTTPS URLの場合はそのまま連結、ローカルパス（`C:/...` 等）の場合は `file:///` URI に変換されます。
:::figure width=60% origin=external
![外部起点の図](logo.png)
外部（https://example.com/images/logo.png）から読み込んだ図
:::

## figure（図 — 配置指定）
`align=` 属性で図の水平配置を指定できます。省略時は `center`（中央揃え）です。

左揃え：
:::figure width=40% align=left origin=internal
![左揃えの図](sample.png)
左揃えで表示した図
:::

中央揃え（デフォルト）：
:::figure width=40% align=center origin=internal
![中央揃えの図](sample.png)
中央揃えで表示した図
:::

右揃え：
:::figure width=40% align=right origin=internal
![右揃えの図](sample.png)
右揃えで表示した図
:::

## table（キャプション付き表）

:::table
ユーザー一覧

| ID  | 名前     | 権限   |
| --- | -------- | ------ |
| 001 | 山田太郎 | 管理者 |
| 002 | 鈴木花子 | 一般   |
:::

テーブルのセル内で改行するには `<br>` を直接書きます。

| 項目   | 内容                      |
| ------ | ------------------------- |
| 対応OS | Windows<br>macOS<br>Linux |
| 備考   | 1行目<br>2行目            |

---

# ページ区切り

以下の行でPDF上のページが切り替わります。

:::pagebreak
:::

# ページ区切り後のページ

ページ区切り後のコンテンツです。PDF で確認すると、このセクションが新しいページに始まります。

## まとめ

このサンプルで確認できる要素：

| カテゴリ     | 要素                                                                         |
| ------------ | ---------------------------------------------------------------------------- |
| Markdown標準 | 見出し・リスト・表・コード・引用・区切り線                                   |
| 自動番号     | h1〜h3 に章番号が付く                                                        |
| DSL ブロック | warning / center / right / large / red                                       |
| DSL 図       | figure（幅・高さ指定対応、キャプション付き）                                 |
| 図パス制御   | origin=internal（assetsInternal起点）/ origin=external（assetsExternal起点） |
| DSL 表       | table（キャプション付き）                                                    |
| Mermaid      | flowchart / sequenceDiagram など                                             |
| ページ制御   | pagebreak                                                                    |
| PDF 設定     | page.json（用紙・余白）                                                      |
| スタイル設定 | style.json（フォント・色・スペーシング）                                     |
