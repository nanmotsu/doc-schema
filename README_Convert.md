# README Convert

## 対象

- .tools/scripts/convert/build.mjs
- .tools/scripts/convert/build_word.mjs
- .tools/scripts/convert/gen_snippets.mjs
- 000_schema/convert/dsl.json
- 000_schema/convert/style.json
- 000_schema/convert/page.json

## 役割

- Markdown から HTML/PDF 生成
- Markdown から Word 生成
- DSL スニペット生成

## 主なコマンド

```bash
node .tools/scripts/convert/build.mjs "<target.md>" --html-only
node .tools/scripts/convert/build.mjs "<target.md>"
node .tools/scripts/convert/build_word.mjs "<target.md>"
node .tools/scripts/convert/gen_snippets.mjs
```

## 補足

- PDF/Word 変換は Chrome/Puppeteer 環境が必要
- Word 変換の詳細メモは README_WORD.md を参照

## 依存ライブラリ

`.tools/package.json` に定義される関連ライブラリ:

- `marked`: Markdown 解析
- `mermaid` / `@mermaid-js/mermaid-cli`: Mermaid 図のレンダリング
- `puppeteer`: HTML/PDF/画像処理
- `html-to-docx`: Word 変換

