# フォルダ構成ガイド

このディレクトリは、新しい docs-first 形式のプロジェクト構成サンプルです。

## 1. ルート構成

```text
フォルダ構成/
├─ src/
├─ tests/
├─ docs/
└─ README.md
```

- `src`: アプリケーション実装
- `tests`: 自動テストコード
- `docs`: 要件、仕様、運用、会議、リリース記録

## 2. 運用原則

- 文書種別の正本は `000_schema/document/schemas/*.json`
- 必須リンクの運用は `README_Project.md` の strict-phase に従う
- 新規文書はスクリプト生成を優先し、手作業作成時も front matter を必ず維持する

## 3. docs 配下の主要領域

- `docs/10_specs`: issue / decision / requirement / specification / change
- `docs/20_tests`: test_case
- `docs/30_operations`: setup / deploy / runbook / manual
- `docs/40_customer_outputs`: 顧客提出物
- `docs/50_meetings`: meeting_note
- `docs/60_release`: release_note
- `docs/90_generated`: 変換生成物や移行時アーカイブ

詳細は `docs/README.md` を参照。
