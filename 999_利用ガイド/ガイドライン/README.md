# ガイドライン

このディレクトリの運用ルールは、この README 1 本に統合しました。

## 1. 参照の優先順位

1. `000_schema/document/schemas/*.json`（種別・必須項目の正本）
2. `README_Project.md`（フェーズ運用・strict-phase）
3. `README_DocumentManagement.md`（作成/一括作成/一覧）
4. `README_TestExcel.md`（テスト YAML / Excel）

運用判断で迷った場合は、上から順に優先します。

## 2. 文書作成の基本ルール

- front matter はスキーマ準拠で記載する
- フェーズの接続は最小にする（不要な多重リンクを張らない）
- strict-phase を使う場合、必須リンクは「フェーズ別に 1 系統」を満たす
- 本文の見出し1（`#`）は文書の主題を端的に書く
- 画像は成果物（png/jpg）と作成元データ（drawio/excalidraw 等）を分離保管する

## 3. フェーズの基準チェーン

標準は以下。

`Meeting -> Issue -> Decision -> Requirement -> Specification -> Test Case -> Release`

補助チェーン（軽微改修 / 変更票 / 改造案件）は次を使用。

- Lv1: `Issue -> Ticket Level1 -> Test Case`
- Lv2: `Issue -> Decision -> Change Level2 -> Specification -> Test Case`
- Lv3: `Issue -> Decision -> Mod Project -> Requirement -> Specification -> Test Case`

## 4. 主な文書種別

主要な種別（key）は次の通りです。

- 起点: `meeting_note`, `issue`, `risk`
- 意思決定: `decision`
- 要件/仕様: `requirement`, `specification`
- 実装/試験: `ticket_level1`, `change_level2`, `mod_project`, `test_case`
- 運用/提供物: `manual`, `runbook`, `customer_artifact`, `release_note`

レガシー互換の `source`, `spec_internal`, `spec_external`, `task_impl`, `task_test`, `design_internal`, `design_external`, `trouble_shooting` は `000_schema/document/schemas/_legacy` に退避しています。新規は標準チェーン側を優先してください。

## 5. ツールの使い分け

- VS Code:
  - 新規作成
  - strict-phase 検証
  - タスク実行（変換/検証/生成）
- graph UI (`.tools/scripts/document/graph`):
  - 文書間トレース確認
  - ステータス変更
- Obsidian/Foam:
  - 参照中心の閲覧や軽微な本文編集（スキーマ更新や一括運用は VS Code 優先）

## 6. テスト仕様（YAML）

テスト仕様の構成・検証・Excel 出力は `README_TestExcel.md` を参照してください。

サンプル:

- `999_利用ガイド/テスト結果サンプル/`
