# README Test Excel

## 対象

- .tools/scripts/test/gen_excel.mjs
- .tools/scripts/test/validate.mjs
- .tools/scripts/test/grid/grid.mjs
- 000_schema/test/excel_columns.json

## 役割

- TEST-*.yaml から Excel 出力
- テスト仕様検証
- グリッド画面で編集/確認

## 主なコマンド

```bash
node .tools/scripts/test/gen_excel.mjs "999_利用ガイド/テスト結果サンプル"
node .tools/scripts/test/validate.mjs
```

## 補足

- 証跡は screenshot を中心に管理
- evidence の運用はガイドラインを参照

## 依存ライブラリ

`.tools/package.json` に定義される関連ライブラリ:

- `exceljs`: Excel ファイル生成
- `js-yaml`: YAML テスト仕様の読み込み
