# copilot_cli

GitHub Copilot CLI を Node.js から実行し、設定駆動で複数ステップの入出力をつないで処理するパイプラインです。

## できること

- `config/pipeline.json` で実行設定を宣言
- `promptTemplate` を外部ファイル（`promptTemplatePath`）へ分離可能
- stepごとに `model` を個別指定可能
- stepごとに `executor`（`copilot` / `api`）を指定可能
- `steps` から `inputs` を省略し、テンプレート側で入力参照可能
- 複数出力のステップ実行
- 任意のJSONファイルのキー値を起点にしたループ実行
- `step7 -> step8 -> step9 -> step7 ...` のような反復実行
- `stderr` 検出時に即停止
- `--from stepX` による途中再開
- `--loop-index N` によるループ反復位置からの再開
- `--to stepY` と `--to-loop-index M` による終了位置指定
- `--dry-run` でトークン未消費の疑似実行
- `--admin` または `adminMode: true` で管理者モード必須化
- 実行状況と成果物を確認できる UI
- UIのボタンから実行開始（通常実行 / Dry Run）
- 実行中プログレスバー表示（現在 step / iteration）
- UIの停止ボタンからキャンセル要求

## ディレクトリ構成

- `src/core`: パイプライン中核処理
- `src/services`: 外部連携（Copilot/API実行, 管理者判定, preflight, UI API）
- `src/ui`: 予備領域（将来 UI 実装分離用）
- `public`: ブラウザ UI の静的ファイル
- `config/pipeline.json`: 実行定義
- `config/.runs`: 実行状態と履歴
- `input`: 初期入力
- `output`: 生成物

## 処理フロー

1. `src/index.ts` が引数を解釈
2. `src/core/config.ts` が `config/pipeline.json` を読み込み検証
3. `src/core/engine.ts` がステップを順に実行
4. 各ステップで:
   - テンプレート内の `{{file:...}}` で入力ファイルを読み込み
   - テンプレートに値を差し込みプロンプト生成
   - `src/services/copilotClient.ts` で `copilot -p` 実行
   - 出力をファイル保存
   - 出力ごとにスキーマ検証（次ステップ進行前に必須）
   - 必要に応じて変数抽出（例: `loopCount`）
   - 実行前に preflight で executor と step定義の整合を検証
5. `src/core/state.ts` が進捗を都度保存
6. エラー時は失敗状態で停止、成功時は completed で終了

## ループ実行のつながり

`engine.ts` は連続する同一 loop 定義のステップを 1 グループとして扱います。

- 例: `step7`, `step8`, `step9` が同じ loop 定義
- 実行順: `7(0) -> 8(0) -> 9(0) -> 7(1) -> 8(1) -> 9(1) ...`
- UI/CLI の loopIndex 指定と出力ファイル名は 1 始まり（`1, 2, 3...`）で扱います。
- `--to step8 --to-loop-index 2` のようにループグループ途中を終了指定した場合、実行順でそれ以前に当たる後続ステップ（例: `step9` の 1）は通過しますが、境界を越えるもの（例: `step9` の 2）は実行しません。
- 開始指定（例: `--from step8 --loop-index 2`）も同様で、実行順で境界より前にあるもの（例: `step9` の 1）は実行されず、境界以降だけを実行します。
- ループ回数: `loop.path + loop.jsonPath` で指定した値
- `jsonPath` が配列なら配列長、数値ならその値を回数として利用

## UI のつながり

- サーバ: `src/services/uiServer.ts`
- 画面: `public/index.html`
- ロジック: `public/main.js`
- スタイル: `public/styles.css`

UI API:

- `GET /api/runtime`: 最新実行状態
- `GET /api/runs`: 直近 run 履歴
- `GET /api/outputs?runId=...`: 出力ファイル一覧（runId 指定時はスナップショット）
- `GET /api/output?path=...&runId=...`: 出力ファイル内容（runId 指定時はスナップショット）
- `GET /api/pipeline`: 進捗計算用ステップ情報
- `GET /api/control`: 実行中/キャンセル要求状態
- `POST /api/run`: UIから実行開始
- `POST /api/cancel`: UIからキャンセル要求

`POST /api/run` 追加フィールド:

- `model`: 全ステップ共通の実行時モデル上書き
- `stepModels`: stepごとの実行時モデル上書き（`{ "step7": "..." }` 形式）
- `sourceRunId`: スナップショットを復元して再実行する場合の復元元 runId

## UI操作

1. `npm run ui -- --config config/pipeline.json` でUIを起動
2. ブラウザで `http://localhost:4173` を開く
3. 必要なら開始ステップIDを入力（例: `step7`）
   - 開始ステップはプルダウンで選択
   - ループステップを途中再開したい場合は開始 loopIndex（1以上の整数）を指定
   - 必要なら終了ステップと終了 loopIndex も指定
4. `実行` または `Dry Run` ボタンを押す
5. 実行中はプログレスバーと `現在: step / iteration` を確認
6. 停止したい場合は `停止（キャンセル）` を押す

ステップ進行表（完了数）の表示ポリシー:

- 分子（完了数）は、`completed` ログ件数と実在する出力ファイル件数の大きい方を使用します。
- 分母（期待数）はステップごとに算出し、`max(1, 分子, 実行中iteration+1)` を使用します。
- これにより、スナップショット参照や途中再実行時でも、実データに沿った表示を優先します。

注意:

- キャンセルは「要求」を送る方式です
- 実行の区切りで安全に停止され、実行状態は `cancelled` になります

## 出力と再実行ルール

出力の扱いは以下の通りです。

1. 新規実行（`fromStepId` なし）
- 実行開始時に `output` ディレクトリを一掃します。
- 空の状態から先頭ステップを実行します。

2. 新規 + `fromStepId` 指定実行（`sourceRunId` なし）
- 現在の `output` を起点として、`fromStepId` より前に必要な出力が揃っているか検証します。
- 不足がある場合は UI でアラートを出し、実行を開始しません。
- 検証に通った場合は、`fromStepId` 以降の出力だけ削除して対象ステップから再実行します。
- このとき `fromStepId` より前の流用出力は新しい run のスナップショット（`config/.runs/<newRunId>/output`）にも引き継がれます。

3. スナップショット + `fromStepId` 指定実行（`sourceRunId` あり）
- `sourceRunId` のスナップショット（`config/.runs/<runId>/output`）に、`fromStepId` より前の必要出力が揃っているか検証します。
- 不足がある場合は実行を開始しません（UI はアラート表示）。
- 検証に通った場合は `output` を一掃し、スナップショットを復元してから `fromStepId` 以降の出力だけ削除し、対象ステップから再実行します。
- 復元した `fromStepId` より前の出力は、新しい run のスナップショット（`config/.runs/<newRunId>/output`）にも引き継がれます。

4. runId ごとの出力保存
- 実行中に生成された出力は通常の `output` に加えて、`config/.runs/<newRunId>/output` にも保存されます。
- UI で runId を選ぶと、その runId のスナップショット出力を参照できます。

5. UI の再実行確認
- 過去 runId を選択した状態で実行ボタンを押すと、上書き再実行の確認ダイアログを表示します。

補足:

- `fromStepId` を使う場合は「それ以前の必須出力が揃っていること」が前提です。
- 新規実行（`fromStepId` なし）は毎回 `output` を一掃して先頭から実行します。

## 実行コマンド

```bash
npm run build
npm run run -- --config config/pipeline.json
npm run dry-run -- --config config/pipeline.json
npm run run -- --config config/pipeline.json --from step7
npm run run -- --config config/pipeline.json --admin
npm run ui -- --config config/pipeline.json
```

## 主な設定項目（config/pipeline.json）

- `workingDirectory`: Copilot 実行時のカレントディレクトリ
- `defaultModel`: 既定モデル
- `adminMode`: 管理者モード要求
- `provider`: 実行コマンド（既定は `copilot -p`）
- `apiProvider`: API実行コマンド（例: `curl`。stdout を step出力として利用）
- `ui.progressPollMs`: UIの進捗ポーリング間隔（ミリ秒、既定 3000）
- `run.stateDir`: 状態保存先（`<stateDir>/<runId>/state.json`）
- `steps[]`: 各ステップの `executor`, `requiresWorkspaceMutation`, `requiresCommandExecution`, `outputs`, `loop(path/jsonPath)`, `extractVars`, `promptTemplatePath*`

dry-run 待機時間:

- `run.dryRunDelaySeconds` で、dry-run時の全ステップ共通待機秒数を指定できます。
- 指定がない場合は `0` 秒（待機なし）です。
- 例: `"run": { "stateDir": ".runs", "dryRunDelaySeconds": 1.5 }` で、各ステップごとに 1.5 秒待機します。

モデル指定ルール:

- `steps[].model` があればそのモデルを使用
- 未指定なら `defaultModel` を使用

## パス解決ルール

- `outputs.path` / `schemaPath` は「このプロジェクトルート」基準の相対パス
- `workingDirectory` は Copilot プロセスの実行ディレクトリであり、プロジェクト外も指定可能
- そのため、入出力の配置場所と Copilot 実行場所を分離できる

## 外部プロンプトテンプレート

- 共通で `promptTemplatePath` を参照可能
- `executor: copilot` では `promptTemplatePathCopilot` を優先
- `executor: api` では `promptTemplatePathApi` を優先
- `promptTemplatePath` のサフィックス切替にも対応
   - 例: `config/prompts/step1.md` を基準に、`executor: copilot` なら `config/prompts/step1.copilot.md` を優先
   - 例: `executor: api` なら `config/prompts/step1.api.md` を優先
   - 優先順位は `promptTemplatePathCopilot/Api` > サフィックス付き > `promptTemplatePath`
   - 事故防止モード: 各stepで executor 対応サフィックスファイルが必須（無い場合は preflight で失敗）
- テンプレート内で `{{absPath:相対パス}}` を使うと、Copilot 発火直前に絶対パスへ変換される
- テンプレート内で `{{file:相対パス}}` を使うと、対象ファイル本文を埋め込める
- `{{overviewPath}}` のように `outputs` 名 + `Path` 変数も利用可能

## 実行前チェック（Preflight）

- `executor: api` の step では `requiresWorkspaceMutation: true` を禁止
- `executor: api` の step では `requiresCommandExecution: true` を禁止
- `executor: api` の step がある場合、`apiProvider` が必須
- executor に対応するプロンプト（inline/path）が不足している step は実行前に失敗
- 全stepで `promptTemplatePath` から導出される executor 対応サフィックスファイル（`.copilot` / `.api`）が無い場合は実行前に失敗

Preflight 失敗例:

- `executor: api` と `requiresWorkspaceMutation: true` を同時指定
- `executor: api` と `requiresCommandExecution: true` を同時指定
- `executor: api` の step があるのに `apiProvider` が未設定

## pipeline.json サンプル

最小サンプル（Copilot と API の混在）:

      {
         "workingDirectory": ".",
         "defaultModel": "auto",
         "provider": {
            "executable": "copilot",
            "args": ["--model", "{{model}}", "-p", "{{prompt}}", "-s", "--allow-all-tools", "--allow-all-paths", "--allow-all-urls", "--no-color"]
         },
         "apiProvider": {
            "executable": "curl",
            "args": ["-s", "https://example.invalid/llm", "-d", "prompt={{prompt}}", "-d", "model={{model}}"]
         },
         "run": {
            "stateDir": ".runs"
         },
         "steps": [
            {
               "id": "stepA",
               "executor": "copilot",
               "requiresWorkspaceMutation": true,
               "requiresCommandExecution": true,
               "promptTemplatePathCopilot": "config/prompts/stepA.copilot.md",
               "outputs": [
                  {
                     "name": "resultA",
                     "path": "output/stepA.txt",
                     "schemaPath": "config/schemas/text-output.schema.json"
                  }
               ]
            },
            {
               "id": "stepB",
               "executor": "api",
               "requiresWorkspaceMutation": false,
               "requiresCommandExecution": false,
               "promptTemplatePathApi": "config/prompts/stepB.api.md",
               "outputs": [
                  {
                     "name": "resultB",
                     "path": "output/stepB.json",
                     "format": "json",
                     "schemaPath": "config/schemas/targets.schema.json"
                  }
               ]
            }
         ]
      }

## 出力スキーマ

- すべての `outputs[]` に `schemaPath`（または `schema`）が必須
- 検証に失敗した場合、その時点でパイプラインは停止
- スキーマファイルは `config/schemas` 配下に分離して管理

## プロンプト標準形

各ステップの `promptTemplate` は以下の基本形で記述します。

```text
## 目的

## 入力

## 出力

## 制約
```

現在の `config/pipeline.json` は全ステップをこの形式に統一済みです。

## 設計メモ

- 型定義は `src/core/types.ts` に集約
- テンプレート処理は `src/core/template.ts`
- JSON パス処理は `src/core/jsonPath.ts`
- AJV で JSON スキーマ検証
- Tailwind は `public/index.html` の CDN で利用可能
