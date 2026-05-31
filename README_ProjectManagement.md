# README Project Management

## 対象

- .tools/scripts/project/new_project.mjs
- .tools/scripts/project/validate.mjs
- .tools/scripts/shared/definitions.mjs

## 役割

- プロジェクト雛形の作成
- front matter のスキーマ検証
- strict-phase によるフェーズ必須リンク検証

## 主なコマンド

```bash
node .tools/scripts/project/new_project.mjs
node .tools/scripts/project/validate.mjs
node .tools/scripts/project/validate.mjs --strict-phase
```

## strict-phase の目的

- フェーズのつながりを維持する
- 過剰なリンク定義を抑制する
- レビュー観点を明確化する

## 依存ライブラリ

`.tools/package.json` に定義される関連ライブラリ:

- `ajv`: JSON Schema 検証
- `js-yaml`: front matter YAML 解析
