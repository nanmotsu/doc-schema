---
name: markdown-pdf-convert-dsl-rules
description: "Use when: このリポジトリの Markdown を PDF 変換する前提で、DSL・frontmatter・参照記法の暗黙ルールに沿って文書作成/修正したい。キーワード: Markdown PDF変換, DSL, figure, table, ref, frontmatter, assetsBase, toc, page.json"
---

# Markdown PDF変換（DSL暗黙ルール準拠）

## 目的
このリポジトリの変換スクリプト群（主に build.mjs）に合わせて、Markdown を PDF/HTML に安定変換できる入力へ整える。

## 対象
- Markdown 本文
- frontmatter
- DSL ブロック（:::...）
- 図表参照（{{ref:...}} / [[ref:...]])

## 使うべき場面
- PDF 変換エラーの原因が Markdown 側の書き方にある可能性が高いとき
- 仕様書テンプレートを作るとき
- 図表番号や参照の整合を取りたいとき
- frontmatter と schema の優先順位を誤りたくないとき

## 実行コマンド
```bash
node .tools/scripts/convert/build.mjs "<target.md>" --html-only
node .tools/scripts/convert/build.mjs "<target.md>"
```

## コア原則
1. 図番号対象は `:::figure` に統一する（画像・Mermaid・通常コードを含む）。
2. 表番号対象は `:::table` に統一する。
3. 図表参照は id を付け、本文で `{{ref:id}}` または `[[ref:id]]` を使う。
4. frontmatter は文書ローカル設定、schema は既定値として使い分ける。

## DSLルール（暗黙仕様含む）
1. DSL は `:::type [attrs]` から `:::` までを 1 ブロックとして扱う。
2. `:::hide` ブロック内は最終出力から除外され、図表参照カウントにも含めない。
3. `:::figure` のキャプション抽出:
   - 画像図: `![...](...)` 行以外の非空行を連結してキャプション化。
   - 非画像図: 「コードフェンス外の最後の非空行」をキャプション化。
4. `:::figure height=...` かつ中身が Mermaid の場合、Mermaid 先頭に `%%height:...%%` がなければ自動補完される。
5. `:::table` のキャプション抽出:
   - 先頭行が `|` で始まる場合はキャプションなし。
   - それ以外は先頭行をキャプションとして扱う。
6. `:::table colRatio=2,3` のような比率指定は `<colgroup>` に変換され、`table-layout: fixed` が付与される。

## 参照・採番ルール（重要）
1. 参照 ID が重複すると変換はエラーで中断する。
2. 未解決参照 ID は警告扱いで、参照文字列が残る。
3. 採番対象見出しは h1-h3。
4. 有効見出しレベルは `style.json` の `heading.levels`。
5. `heading.numbering=true` の場合のみ見出し連番と 図x.y/表x.y を生成する。
6. 最上位採番見出し（通常 h1）が進んだら、図/表カウンタはリセットされる。
7. コードフェンス内の `#` は見出しカウント対象外。

## frontmatter 優先順位
1. ページ設定は frontmatter 優先、未指定のみ `000_schema/convert/page.json` へフォールバック。
2. 対象キー:
   - `paper`, `orientation`, `margin.top|right|bottom|left`
   - `tocDepth`, `paragraphIndent`
   - `headerFooter`
3. 見出し番号の ON/OFF は次の優先順:
   - `headingNumbering`
   - `heading.numbering`
   - `000_schema/convert/style.json`

## assetsBase ルール
1. `assetsBase` 指定あり: ワークスペースルート起点で解決する。
2. `assetsBase` 未指定: 変換対象 Markdown の配置フォルダ起点で解決する。
3. 相対画像パスは最終的に `file:///` の絶対パスへ変換される。

## TOC・タイトル・改訂履歴
1. TOC は `toc: false` で無効化できる。
2. `tocManual` があれば手入力目次を優先する。
3. `titlePage: false` でタイトルページを無効化できる。
4. `revisionHistory` が配列なら改訂履歴ページを生成する（`revisionHistoryPage: false` で抑止）。

## 出力先ルール
1. `htmlOutputDir` / `pdfOutputDir` は「存在するディレクトリ」のみ許可。
2. 未存在やファイル指定はエラーになるため、事前に作成しておく。
3. ファイル名は `htmlFileName` / `pdfFileName` で上書き可能。

## 推奨ワークフロー
1. 参照付き図表を先に確定し、`id` を振る。
2. `--html-only` で高速確認する。
3. 警告（未解決参照）と見た目崩れを直す。
4. 最後に PDF 生成を実行する。

## 出力フォーマット（このSkillでの回答）
- ルール確認時:
  - Rule ID（C1, C2...）
  - 対象（frontmatter / DSL / 参照 / 採番 / 出力先）
  - 判定（OK / 要修正）
  - 修正案（最小差分）
- 修正実施時:
  - Fix ID（P1, P2...）
  - 変更ファイル
  - 変更位置（行番号）
  - 変更要約

## 禁止・非推奨
1. 旧記法 `%%fig` / `%%caption` は使わない。
2. 図表番号を DSL 外で手打ちしない（参照解決と不整合になる）。
3. 参照 ID の使い回しをしない。

## 最小チェックリスト
- `:::figure` / `:::table` を正しく閉じている
- `id` が一意
- `{{ref:id}}` が実在IDを参照
- `assetsBase` の有無と相対パスの起点が意図通り
- 出力ディレクトリが事前に存在
