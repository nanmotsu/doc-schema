# README Document Management

docs-first 系の文書作成・一括作成・テンプレート生成の案内です。

## 対象

- .tools/scripts/document/create.mjs
- .tools/scripts/document/create_levels.mjs
- .tools/scripts/document/batch.mjs
- .tools/scripts/document/list.mjs
- .tools/scripts/document/gen_obsidian_templates.mjs

## 役割

- 1件作成
- Lv1/Lv2/Lv3 の段階作成
- フローによる一括作成
- 一覧表示
- テンプレート生成
- release / customer_artifact を含む周辺文書の生成支援

## 主なコマンド

```bash
node .tools/scripts/document/create.mjs
node .tools/scripts/document/create_levels.mjs
node .tools/scripts/document/batch.mjs
node .tools/scripts/document/list.mjs
node .tools/scripts/document/gen_obsidian_templates.mjs
```

## create.mjs の入力項目

`create.mjs` では、以下を対話形式で決めて 1 ファイルを作成します。

- プロジェクト
- 文書種別
- ID 採番
- タイトル
- status
- owner
- visibility

入力方針:

- `status`: 原則 `draft` から開始
- `owner`: 未確定なら `TBD`
- `visibility`: 迷ったら `internal`

`create_levels.mjs` / `batch.mjs` でも、共通 `owner` を 1 回入力して各ファイルへ反映します。
必要な文書種別では `tags` や関係 ID もまとめて反映できます。

関連項目は、front matter では `[[ファイル名]]` を YAML の文字列として入れる。
実際の記述は `"[[ファイル名]]"` の形にして、FOAM / Obsidian でクリック可能にしたまま graph でも追跡できるようにする。

## issue を経由しないパターン

すべての文書が `issue` 起点である必要はありません。

- 運用手順: `runbook`
- 利用説明: `manual`
- 客先向け成果物: `customer_artifact`
- リリース整理: `release_note`

これらは、問題起点の整理ではなく、単独で作成してよい文書です。

## 共通 front matter 項目

docs-first 系の標準文書では、少なくとも以下を意識して入力します。

### status

標準値:

- `draft`
- `review`
- `approved`
- `active`
- `deprecated`
- `closed`

使い分け:

- 下書き: `draft`
- 確認依頼中: `review`
- 合意済み: `approved`
- 現在の運用基準: `active`
- 後継へ移行済み: `deprecated`
- 追記終了: `closed`

### visibility

標準値:

- `internal`
- `customer`
- `partial`
- `confidential`

使い分け:

- 社内専用: `internal`
- 顧客提示前提: `customer`
- 一部転記前提: `partial`
- 強い秘匿対象: `confidential`

### owner

- 文書の責任窓口を入れる
- 個人名、担当ロール、チーム名のいずれでも可
- 未確定なら `TBD` で開始し、`approved` までに確定する

詳細な意味づけは `README_Project.md` の「3.1 共通 front matter 項目」を参照してください。

## VS Code スニペット

`.vscode/project-docs.code-snippets` に、文書作成用スニペットを生成しています。

共通補助:

- `fm.common`: 共通 front matter の最小セット
- `fm.status`: status 行
- `fm.visibility`: visibility 行
- `fm.owner`: owner 行

文書テンプレート:

- `doc.issue`
- `doc.dec`
- `doc.req`
- `doc.spec`
- `doc.bug`
- `doc.chg`
- `doc.mod`
- `doc.meeting`
- `doc.runbook`
- `doc.manual`
- `doc.customer_artifact`
- `doc.release_note`

補助テンプレート:

- `flow.level1_quick_fix`
- `flow.level2_change`
- `flow.level3_mod_project`
- `flow.release_closure`

これらのテンプレートは、`status` / `visibility` / `owner` を補完候補つきで入力できます。

移行補足:

- 旧仕様の `source` / `task_impl` 用スニペットは `legacy.doc.src` / `legacy.doc.task` として残し、新規作成では使わない

## Lv1/Lv2/Lv3 で生成されるもの（詳細）

`create_levels.mjs` は、入力した共通タイトルを使って複数ドキュメントを自動作成します。

実行コマンド:

```bash
node .tools/scripts/document/create_levels.mjs
node .tools/scripts/document/create_levels.mjs 001_blueberry_system
```

### Lv1 で生成されるもの

`issue` は任意です。必要なときだけ作成し、不要なら `ticket_level1` と `test_case` だけを作成できます。

生成対象（3件）:

- `issue`（ISSUE-YYYY-NNN）
	- 保存先: `docs/10_specs/issues/`
- `ticket_level1`（BUG-YYYY-NNN）
	- 保存先: `docs/10_specs/changes/level1_tickets/`
- `test_case`（TEST-YYYY-NNN）
	- 保存先: `docs/20_tests/master_test_cases/`

対応フロー:

- `level1_quick_fix`

ファイル名パターン:

- `ID_共通タイトル.md`
- 例: `ISSUE-2026-001_ログイン不具合.md`

### Lv2 で生成されるもの

`issue` は任意です。必要なときだけ作成し、不要なら `decision` / `change_level2` / `specification` / `test_case` だけを作成できます。

生成対象（5件）:

- `issue`（ISSUE-YYYY-NNN）
	- 保存先: `docs/10_specs/issues/`
- `decision`（DEC-YYYY-NNN）
	- 保存先: `docs/10_specs/decisions/`
- `change_level2`（CHG-YYYY-NNN）
	- 保存先: `docs/10_specs/changes/level2_changes/`
- `specification`（SPEC-YYYY-NNN）
	- 保存先: `docs/10_specs/product_baseline/`
- `test_case`（TEST-YYYY-NNN）
	- 保存先: `docs/20_tests/master_test_cases/`

対応フロー:

- `level2_change`

ファイル名パターン:

- `ID_共通タイトル.md`

### Lv3 で生成されるもの

`issue` は任意です。必要なときだけ作成し、不要なら `decision` / `mod_project` とその配下ドキュメントだけを作成できます。

トップレベル生成（3件）:

- `issue`（ISSUE-YYYY-NNN）
	- 保存先: `docs/10_specs/issues/`
- `decision`（DEC-YYYY-NNN）
	- 保存先: `docs/10_specs/decisions/`
- `mod_project`（MOD-YYYY-NNN）
	- 保存先: `docs/10_specs/changes/level3_projects/`

Lv3 案件フォルダ生成（MOD単位）:

- 作成先: `docs/10_specs/changes/level3_projects/MOD-YYYY-NNN/`
- 固定ファイル:
	- `README.md`
	- `impact_analysis.md`
- 追加ドキュメント（3件）:
	- `REQ-YYYY-NNN_共通タイトル.md`
	- `SPEC-YYYY-NNN_共通タイトル.md`
	- `TEST-YYYY-NNN_共通タイトル.md`

	対応フロー:

	- `level3_mod_project`

### リリース整理

単独で `release_note` を作る場合のフローです。

- `release_note`（RELEASE-YYYY-NNN）
	- 保存先: `docs/60_release/`

対応フロー:

- `release_closure`

注意:

- 既存ファイル名と衝突した場合はエラーで停止
- 作成履歴は `.tools/logs/create_history.jsonl` に追記
- Lv3 の完了表示件数はドキュメント件数（6件）で、`README.md` と `impact_analysis.md` は件数に含めません

## 補足

- schema は 000_schema/document/schemas を参照（旧互換は 000_schema/document/schemas/_legacy）
- flow は 000_schema/document/flows.json を参照
- 生成テンプレートは `.vscode/project-docs.code-snippets` に出力される
- 変更や仕様の流れは `issue -> decision -> requirement/specification -> test_case` を基本にする
- `batch.mjs` のフローでも `issue` は任意で、必要なときだけ作成すればよい
- ただし `runbook` / `manual` / `customer_artifact` / `release_note` は issue を省略して直接作成できる

## 依存ライブラリ

`.tools/package.json` に定義される関連ライブラリ:

- `js-yaml`: front matter の読み書き補助
- `ajv`: スキーマ整合性検証（validate と連携）
