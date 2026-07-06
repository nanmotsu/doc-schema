// モデル名はプロバイダ側で解決されるため文字列として扱う。
export type SupportedModel = string;

// CLIプロバイダの実行コマンド定義（例: gh copilot suggest ...）。
export interface ProviderConfig {
    executable: string;
    args: string[];
    useStdinPrompt?: boolean;
}

// UIサーバの設定。
export interface UiConfig {
    enabled?: boolean;
    port?: number;
    progressPollMs?: number;
}

// 実行状態の保存先設定。
export interface RunConfig {
    stateDir: string;
    dryRunDelaySeconds?: number;
}

// プロンプト変数へ渡す入力ファイル定義。
export interface InputSpec {
    name: string;
    path: string;
}

// 出力ファイル定義と任意のJSON/スキーマ制約。
export interface OutputSpec {
    name: string;
    path: string;
    format?: "text" | "json";
    schemaPath?: string;
    schema?: Record<string, unknown>;
}

// ステップ出力から変数を抽出する定義。
export interface ExtractVarSpec {
    name: string;
    mode: "jsonPathArrayLength";
    fromOutputName: string;
    jsonPath: string;
}

// 反復ステップで共有するループ定義。
export interface LoopSpec {
    path: string;
    jsonPath: string;
    iteratorVar?: string;
}

// パイプラインのステップ定義。
export interface StepSpec {
    id: string;
    promptTemplate?: string;
    promptTemplatePath?: string;
    model?: SupportedModel;
    inputs?: InputSpec[];
    outputs: OutputSpec[];
    extractVars?: ExtractVarSpec[];
    loop?: LoopSpec;
}

// config/pipeline.json から読み込む設定全体の型。
export interface PipelineConfig {
    workingDirectory: string;
    defaultModel: SupportedModel;
    modelEnum?: SupportedModel[];
    provider: ProviderConfig;
    ui?: UiConfig;
    run: RunConfig;
    adminMode?: boolean;
    steps: StepSpec[];
}

// パイプライン全体の実行フェーズ。
export type PipelinePhase = "idle" | "running" | "failed" | "cancelled" | "completed";

// 実行状態に記録するステップ単位のログ。
export interface StepLog {
    at: string;
    stepId: string;
    iteration: number;
    phase: "started" | "completed" | "failed";
    message: string;
}

// 現在実行と履歴実行で永続化される状態。
export interface RuntimeState {
    runId: string;
    phase: PipelinePhase;
    startedAt: string;
    endedAt?: string;
    fromStepId: string;
    dryRun: boolean;
    adminMode: boolean;
    currentStepId?: string;
    currentIteration?: number;
    variables: Record<string, number | string>;
    logs: StepLog[];
    error?: string;
}

// プロバイダ実行結果のラッパー。
export interface CopilotExecutionResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
