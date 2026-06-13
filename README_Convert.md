# README Convert

## 対象

- .tools/scripts/convert/build.mjs
- .tools/scripts/convert/build_word.mjs
- .tools/scripts/convert/build_from_word.mjs
- .tools/scripts/convert/gen_snippets.mjs
- .tools/scripts/convert/gui/editor_highlight_theme.yaml
- 000_schema/convert/dsl.json
- 000_schema/convert/style.json
- 000_schema/convert/page.json

## 役割

- Markdown から HTML/PDF 生成
- Markdown から Word 生成
- Word から Markdown 逆変換
- DSL スニペット生成

## 主なコマンド

```bash
node .tools/scripts/convert/build.mjs "<target.md>" --html-only
node .tools/scripts/convert/build.mjs "<target.md>"
node .tools/scripts/convert/build_word.mjs "<target.md>"
node .tools/scripts/convert/build_from_word.mjs "<target.docx>"
node .tools/scripts/convert/gen_snippets.mjs
```

## 変換GUI（左Markdown / 右HTML）

- サーバー: `.tools/scripts/convert/gui/gui.mjs`
- URL: `http://localhost:3355`
- 既定の対象フォルダ: `999_利用ガイド/変換サンプル`

### ディレクトリ構成（convert）

```text
.tools/scripts/convert/
|- build.mjs            # Markdown -> HTML/PDF 本体
|- gui/
|  |- gui.mjs           # GUIサーバー（編集、プレビュー、PDF出力）
|  |- gui.html          # GUIフロントエンド
|  `- editor_highlight_theme.yaml # GUI「色付け」表示テーマ
|- render_common.mjs    # build/gui 共通ロジック
|- dsl.mjs              # DSL(:::) 変換
|- references.mjs       # {{ref:...}} / [[ref:...]] 解決
`- styles.css           # 変換HTMLの構造CSS
```

### 共通化方針（差分を出さないための運用）

- `build.mjs` と `gui.mjs` で重複する処理は `render_common.mjs` に集約する
- 現在の共通化対象
    - `page.json` / `style.json` / `dsl.json` の読み込み
    - frontmatter 解析
    - ページ設定解決（frontmatter優先、page.jsonフォールバック）
    - 段落字下げ判定
    - スキーマ由来 CSS 生成
- 今後この領域を変更する場合は、まず `render_common.mjs` を修正し、`build.mjs` と `gui.mjs` からは共通関数を呼ぶだけにする

### 主な操作

- 上部バー
    - `保存`: 現在の Markdown を保存
    - `PDF出力`: 保存後に `build.mjs` を実行して PDF を生成
- 左ペイン（Markdown）
    - 右クリックメニューで `:::pagebreak` / 画像 figure / Mermaid figure を挿入
- 右ペイン（HTML）
    - 入力内容を自動プレビュー（frontmatter優先、page.jsonフォールバック）

### 実行タスク

- `変換: GUI（起動）`
- `変換: GUI（停止）`
- `変換: GUI（ブラウザで開く）`

### GUI色付けテーマ設定

- 設定ファイル: `.tools/scripts/convert/gui/editor_highlight_theme.yaml`
- この YAML を編集すると GUI の「色付け」表示に反映される
- 指定値は CSS カラー（例: `#RRGGBB`）を使用する
- 主な設定キー
    - `colors.heading1` 〜 `colors.heading6` / `colors.headingMark`
    - `colors.dslFence` / `colors.dslType` / `colors.dslArgs` / `colors.dslLine`
    - `colors.codeFence` / `colors.codeLine` / `colors.inlineCode`
    - `colors.link` / `colors.default`

### Word -> Markdown 逆変換ルール

- 出力Markdownは常に英語サフィックス付きの `<元ファイル名>_reverse.md` で生成する（既存ファイルがある場合は `_1`, `_2`... を付与）
- 画像は変換対象ファイルと同階層の `assets/<出力Markdown名（拡張子なし）>` ディレクトリへ保存する
- 画像名は `<元ファイル名>_reverse_img_001.png` のように連番で生成し、衝突時は連番サフィックスを追加する

## 図番号ルール（統一）

- 図番号を付ける対象は、画像、Mermaid、コードブロックを含め、すべて `:::figure` で囲む
- サイズ指定は `:::figure width=... height=...` で行う
- 旧方式の `%%fig: ...%%` / `%%caption: ...%%` は使用しない
- Word 変換（`build_word.mjs`）も同じ統一ルールに対応済み

### 画像パス解決ルール（統一）

- `assetsExternal` / `origin=external` は廃止
- 相対画像パスは次の優先順位で解決する
    1. フロントマター `assetsBase` を指定した場合: そのパス起点
    2. `assetsBase` 未指定の場合: 変換対象Markdownファイルの配置フォルダ起点
- `origin=internal` の明示指定も不要

### 本文から図表番号を参照する

- `:::figure` / `:::table` に `id=...` を付ける
- 本文は `{{ref:id}}` または `[[ref:id]]` で参照する
- 変換時に実際の番号（例: `図3.2` / `表4.1`）へ置換される
- `id` が重複した場合は、変換中にエラーを表示して中断する

```md
表は {{ref:tbl-user-list}} に示す通りです。
図は [[ref:fig-login-flow]] の通りです。

:::table id=tbl-user-list
利用者一覧

| ID  | 名前 |
| --- | ---- |
| 1   | 山田 |
:::

:::figure id=fig-login-flow width=70%
\`\`\`mermaid
flowchart LR
    A --> B
\`\`\`
ログイン処理
:::
```

```md
:::figure width=70% height=60mm
\`\`\`mermaid
flowchart LR
    A --> B --> C
\`\`\`
業務フロー図
:::
```

## 補足

- PDF/Word 変換は Chrome/Puppeteer 環境が必要
- Word 変換の詳細メモは README_WORD.md を参照

## 設定項目と運用ルール

### フロントマター許可キー一覧（文書ごとに変わるもの）

- 文書メタ
    - `title`, `subtitle`, `cover`, `revisionHistory`
- 文書構成
    - `toc`, `tocManual`, `tocDepth`, `titlePage`, `revisionHistoryPage`
- ページ設定（frontmatter優先。未指定は `000_schema/convert/page.json`）
    - `paper`, `orientation`, `margin.top|right|bottom|left`
    - `tocDepth`, `paragraphIndent`（互換: `bodyIndent`）
- 出力先/出力名
    - `htmlOutputDir`, `pdfOutputDir`, `docxOutputDir`
    - `htmlFileName`, `pdfFileName`, `docxFileName`
- 文書ごとのアセット基準
    - `assetsBase`
- 文書ごとのヘッダー/フッター
    - `headerFooter.enabled`
    - `headerFooter.fontSize`
    - `headerFooter.header.left|center|right`
    - `headerFooter.footer.left|center|right`
- 文書ローカル設定/制御
    - `paragraphIndent`（互換用）
    - `bodyIndent`（互換用）

```yaml
paper: A4
orientation: portrait
margin:
    top: 20mm
    right: 10mm
    bottom: 15mm
    left: 15mm
tocDepth: 3
paragraphIndent: true

headerFooter:
    enabled: true
    fontSize: "9px"
    header:
        left: ""
        center: ""
        right: ""
    footer:
        left: ""
        center: "<span class='pageNumber'></span>/<span class='totalPages'></span>"
        right: ""
```

### スキーマ専用キー一覧（普遍的なもの）

- `000_schema/convert/style.json`
    - `typography.*`, `colors.*`, `heading.*`, `spacing.*`, `titlePage.*`
- `000_schema/convert/page.json`
    - `paper`, `orientation`, `margin.*`, `tocDepth`, `paragraphIndent`
- `000_schema/convert/dsl.json`
    - `blocks[*].element/class/styles/counter/caption*`, `defaults`, `snippet`

### 判断基準

- その文書だけで変えるならフロントマター
- 全文書に効く既定値ならスキーマ
- 迷ったら「毎回テンプレート化したいか」で判断する

### frontmatter と page.json の優先順位

- `build.mjs` はページ設定を frontmatter 優先で解決する
- frontmatter で未指定のキーのみ `000_schema/convert/page.json` にフォールバックする
- 対象キー: `paper`, `orientation`, `margin.*`, `tocDepth`, `paragraphIndent`, `headerFooter`

## 依存ライブラリ

`.tools/package.json` に定義される関連ライブラリ:

- `marked`: Markdown 解析
- `mermaid` / `@mermaid-js/mermaid-cli`: Mermaid 図のレンダリング
- `puppeteer`: HTML/PDF/画像の描画
- `html-to-docx`: Word 変換
- `mammoth` / `turndown` / `turndown-plugin-gfm`: Word から Markdown 逆変換