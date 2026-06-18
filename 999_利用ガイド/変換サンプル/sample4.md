---
title: 変換番号リセット確認サンプル4
subtitle: h1 と pagebreak をまたぐ図表番号の確認
assetsBase: 999_利用ガイド/変換サンプル/assets
pdfOutputDir: .
htmlOutputDir: .
docxOutputDir: .
paper: A4
orientation: portrait
margin:
  top: 18mm
  right: 12mm
  bottom: 15mm
  left: 15mm
toc: false
titlePage: false
revisionHistoryPage: false
headingNumbering: true
paragraphIndent: false
orderedListStyle:
  level1: paren-decimal
  level2: decimal
---


# 第1章

第1章の図は [[ref:fig-before]] です。

:::figure id=fig-before width=55%
![第1章の図](sample.png)
第1章の図
:::

:::pagebreak
:::

# 第2章

第2章の図は [[ref:fig-after]] です。

:::figure id=fig-after width=55%
![第2章の図](sample.png)
第2章の図
:::

---

# Mermaid の文字サイズ例

下の 2 つは、Mermaid の既定文字サイズと `%%fontsize` 指定の違いを確認するための例です。

:::figure width=70%
```mermaid
flowchart LR
  A[入力] --> B[処理] --> C[出力]
```
本文と同じくらいの文字サイズ
:::

:::figure width=70%
```mermaid
%%fontsize: 24px%%
flowchart LR
  A[入力] --> B[処理] --> C[出力]
```
明示指定で大きくする
:::

---

# 番号付き箇条書きスタイル例

このセクションは frontmatter の orderedListStyle 設定確認用です。

1. 申請内容の確認
   1. 必須項目のチェック
   2. 添付資料のチェック
2. 承認処理
   1. 担当者レビュー
   2. 最終承認
