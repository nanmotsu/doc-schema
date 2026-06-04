# README Convert

## 対象

- .tools/scripts/convert/build.mjs
- .tools/scripts/convert/build_word.mjs
- .tools/scripts/convert/build_from_word.mjs
- .tools/scripts/convert/gen_snippets.mjs
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

### Word -> Markdown 逆変換ルール

- 出力Markdownは常に英語サフィックス付きの `<元名>_reverse.md` で生成する（既存ファイルがある場合は `_1`, `_2`... を付与）
- 画像は変換対象ファイルと同階層の `assets/<出力Markdown名(拡張子なし)>` ディレクトリへ保存する
- 画像名は `<元名>_reverse_img_001.png` のように連番で生成し、衝突時は連番サフィックスを追加する

## 図番号ルール（統一）

- 図番号を付ける対象（画像・Mermaid・コードブロック）はすべて `:::figure` で囲む
- サイズ指定は `:::figure width=... height=...` で行う
- 旧方式の `%%fig: ...%%` / `%%caption: ...%%` は使用しない
- Word 変換（build_word.mjs）も同じ統一ルールに対応済み

### 画像パス解決ルール（統一）

- `assetsExternal` / `origin=external` は廃止
- 相対画像パスは次の優先順位で解決する
    1. フロントマター `assetsInternal` を指定した場合: そのパス起点
    2. `assetsInternal` 未指定の場合: 変換対象Markdownファイルの配置フォルダ起点
- `origin=internal` の明示指定も不要

### 本文から図表番号を参照する

- `:::figure` / `:::table` に `id=...` を付ける
- 本文では `{{ref:id}}` または `[[ref:id]]` で参照する
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

## 設定の境界（運用ルール）

### フロントマター許可キー一覧（文書ごとに変わるもの）

- 文書メタ
    - `title`, `subtitle`, `cover`, `revisionHistory`
- 文書構成
    - `toc`, `tocManual`, `tocDepth`, `titlePage`, `revisionHistoryPage`
- 出力先/出力名
    - `htmlOutputDir`, `pdfOutputDir`, `docxOutputDir`
    - `htmlFileName`, `pdfFileName`, `docxFileName`
- 文書ごとのアセット基準
    - `assetsInternal`
- 文書ごとのヘッダー/フッター
    - `headerFooter.enabled`
    - `headerFooter.fontSize`
    - `headerFooter.header.left|center|right`
    - `headerFooter.footer.left|center|right`
- 文書ローカル参照/制御
    - `paragraphIndent`（互換用）, `bodyIndent`（互換用）

```yaml
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
- 迷ったら「将来テンプレート化したいか」で判断する

## 依存ライブラリ

`.tools/package.json` に定義される関連ライブラリ:

- `marked`: Markdown 解析
- `mermaid` / `@mermaid-js/mermaid-cli`: Mermaid 図のレンダリング
- `puppeteer`: HTML/PDF/画像処理
- `html-to-docx`: Word 変換
- `mammoth` / `turndown` / `turndown-plugin-gfm`: Word から Markdown 逆変換

