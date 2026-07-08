import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import { loadConfig } from "./config";
import { jsonPathArrayLength, resolveJsonPath } from "./jsonPath";
import { StateStore } from "./state";
import { renderTemplate } from "./template";
import type { PipelineConfig, RuntimeState, StepExecutor, StepSpec, SupportedModel } from "./types";
import { ensureAdminMode } from "../services/admin";
import { ApiClient } from "../services/apiClient";
import { CopilotClient } from "../services/copilotClient";
import { runPreflight } from "../services/preflight";

const ajv = new Ajv({ allErrors: true });

// src/index.ts で解釈されたCLIオプション。
interface RunPipelineOptions {
    configPath: string;
    fromStepId?: string;
    fromLoopIndex?: number;
    toStepId?: string;
    toLoopIndex?: number;
    dryRun: boolean;
    forceAdminMode: boolean;
    sourceRunId?: string;
    model?: SupportedModel;
    stepModels?: Record<string, SupportedModel>;
    shouldCancel?: () => boolean;
}

// 連続ループステップ（7/8/9形式）を判定するためのシグネチャ。
interface LoopSignature {
    path: string;
    jsonPath: string;
    iteratorVar: string;
}

class PipelineCancelledError extends Error {
    constructor() {
        super("Execution cancelled by user.");
        this.name = "PipelineCancelledError";
    }
}

// タイムスタンプからファイル名安全な runId を生成する。
function nowId(): string {
    return new Date().toISOString().replace(/[.:]/g, "-");
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

// 必須入力を読み込み、無ければパス付きで即失敗させる。
function readInputOrThrow(fullPath: string, inputName: string): string {
    if (!existsSync(fullPath)) {
        throw new Error(`Required input '${inputName}' not found at ${fullPath}.`);
    }
    return readFileSync(fullPath, "utf8");
}

// 例外を投げずに安全にJSONパースする。
function parseMaybeJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

// プロジェクトルート相対パスを絶対パスへ変換する。
function toProjectAbsolute(projectRoot: string, maybeRelativePath: string): string {
    if (path.isAbsolute(maybeRelativePath)) {
        return path.normalize(maybeRelativePath);
    }
    return path.resolve(projectRoot, maybeRelativePath);
}

// ステップのテンプレート本文を取得する（外部ファイル対応）。
function resolveStepExecutor(step: StepSpec): StepExecutor {
    return step.executor ?? "copilot";
}

function withPromptSuffix(filePath: string, suffix: "copilot" | "api"): string {
    const parsed = path.parse(filePath);
    if (!parsed.ext) {
        return path.join(parsed.dir, `${parsed.base}.${suffix}`);
    }
    return path.join(parsed.dir, `${parsed.name}.${suffix}${parsed.ext}`);
}

function pickExistingPromptPath(projectRoot: string, candidates: Array<string | undefined>): string | undefined {
    for (const candidate of candidates) {
        if (!candidate) {
            continue;
        }
        const full = toProjectAbsolute(projectRoot, candidate);
        if (existsSync(full)) {
            return candidate;
        }
    }
    return undefined;
}

// ステップのテンプレート本文を取得する（外部ファイル対応）。
function resolvePromptTemplate(step: StepSpec, projectRoot: string, executor: StepExecutor): string {
    const suffixed = step.promptTemplatePath
        ? withPromptSuffix(step.promptTemplatePath, executor)
        : undefined;
    const promptPath = executor === "copilot"
        ? (step.promptTemplatePathCopilot ?? pickExistingPromptPath(projectRoot, [suffixed, step.promptTemplatePath]) ?? step.promptTemplatePath)
        : (step.promptTemplatePathApi ?? pickExistingPromptPath(projectRoot, [suffixed, step.promptTemplatePath]) ?? step.promptTemplatePath);

    if (promptPath) {
        const templatePath = toProjectAbsolute(projectRoot, promptPath);
        if (!existsSync(templatePath)) {
            throw new Error(`Step '${step.id}' promptTemplatePath not found: ${templatePath}`);
        }
        return readFileSync(templatePath, "utf8");
    }
    return step.promptTemplate ?? "";
}

// テンプレート内 {{absPath:relative/path.txt}} を絶対パスへ展開する。
function replaceInlineAbsolutePathTokens(text: string, projectRoot: string): string {
    return text.replace(/\{\{\s*absPath:([^}]+)\s*\}\}/g, (_all, relativePath: string) => {
        return toProjectAbsolute(projectRoot, relativePath.trim());
    });
}

// テンプレート内 {{file:relative/path.txt}} をファイル内容へ展開する。
function replaceInlineFileContentTokens(text: string, projectRoot: string): string {
    return text.replace(/\{\{\s*file:([^}]+)\s*\}\}/g, (_all, relativePath: string) => {
        const fullPath = toProjectAbsolute(projectRoot, relativePath.trim());
        if (!existsSync(fullPath)) {
            throw new Error(`file token path not found: ${fullPath}`);
        }
        return readFileSync(fullPath, "utf8");
    });
}

// ユーザ指定テンプレートが既定見出しを含むか判定する。
function hasPromptSections(text: string): boolean {
    return text.includes("## 目的")
        && text.includes("## 入力")
        && text.includes("## 出力")
        && text.includes("## 制約");
}

// プロンプトを既定の「目的/入力/出力/制約」形式へ正規化する。
function normalizePromptShape(renderedPrompt: string): string {
    if (hasPromptSections(renderedPrompt)) {
        return renderedPrompt;
    }

    return [
        "## 目的",
        "与えられた入力に基づいて、ステップ要求を正確に実行する。",
        "",
        "## 入力",
        renderedPrompt,
        "",
        "## 出力",
        "要求された形式（テキストまたはJSON）で結果を返す。",
        "",
        "## 制約",
        "- 入力に含まれない事実を断定しない。",
        "- JSON指定時は妥当なJSONのみを返す。",
        "- 不足情報がある場合は推定を最小限にする。"
    ].join("\n");
}

// キャンセル要求があれば実行を中断する。
function throwIfCancelled(shouldCancel?: () => boolean): void {
    if (shouldCancel && shouldCancel()) {
        throw new PipelineCancelledError();
    }
}

// ステップモデルを解決し、未指定なら defaultModel を使う。
function resolveModel(
    config: PipelineConfig,
    step: StepSpec,
    overrides?: { model?: SupportedModel; stepModels?: Record<string, SupportedModel> }
): SupportedModel {
    const stepOverride = overrides?.stepModels?.[step.id];
    if (stepOverride && stepOverride.trim().length > 0) {
        return stepOverride;
    }
    if (step.model && step.model.trim().length > 0) {
        return step.model;
    }
    if (overrides?.model && overrides.model.trim().length > 0) {
        return overrides.model;
    }
    return config.defaultModel;
}

// 出力ファイル書き込み前にディレクトリを作成する。
function ensureDirForFile(filePath: string): void {
    mkdirSync(path.dirname(filePath), { recursive: true });
}

function clearDirectory(dir: string): void {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
}

function walkFiles(rootDir: string): string[] {
    if (!existsSync(rootDir)) {
        return [];
    }
    const acc: string[] = [];
    const walk = (dir: string): void => {
        const entries = readdirSync(dir);
        for (const entry of entries) {
            const full = path.join(dir, entry);
            const st = statSync(full);
            if (st.isDirectory()) {
                walk(full);
                continue;
            }
            acc.push(path.relative(rootDir, full).replace(/\\/g, "/"));
        }
    };
    walk(rootDir);
    return acc;
}

function pathTemplateToRegex(templatePath: string): RegExp {
    const escaped = templatePath
        .replace(/\\/g, "/")
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\\\{\\\{[^}]+\\\}\\\}/g, "[^/]+");
    return new RegExp(`^${escaped}$`);
}

function hasMatchingOutputFile(outputRoot: string, outputPathPattern: string): boolean {
    const normalizedPattern = outputPathPattern.replace(/\\/g, "/");
    const patternWithoutOutputPrefix = normalizedPattern.startsWith("output/")
        ? normalizedPattern.slice("output/".length)
        : normalizedPattern;
    const files = walkFiles(outputRoot);
    if (!normalizedPattern.includes("{{")) {
        return files.includes(normalizedPattern) || files.includes(patternWithoutOutputPrefix);
    }
    const rx = pathTemplateToRegex(normalizedPattern);
    const rxWithoutOutputPrefix = pathTemplateToRegex(patternWithoutOutputPrefix);
    return files.some((file) => rx.test(file) || rxWithoutOutputPrefix.test(file));
}

function validateRequiredPreviousOutputs(
    steps: StepSpec[],
    fromIndex: number,
    outputRoot: string,
    sourceLabel: string
): void {
    const missing: string[] = [];
    for (const step of steps.slice(0, fromIndex)) {
        for (const output of step.outputs) {
            if (!hasMatchingOutputFile(outputRoot, output.path)) {
                missing.push(`${step.id}.${output.name} (${output.path})`);
            }
        }
    }

    if (missing.length > 0) {
        throw new Error(
            `fromStepId より前の出力が不足しています: ${sourceLabel}\n`
            + missing.map((entry) => `- ${entry}`).join("\n")
        );
    }
}

function removeOutputsForSteps(
    steps: StepSpec[],
    fromIndex: number,
    outputDir: string,
    fromLoopIndex?: number
): void {
    const files = walkFiles(outputDir);

    const fromStep = steps[fromIndex];
    const baseLoopSignature = fromStep?.loop ? getLoopSignature(fromStep) : null;
    const loopGroupEnd = baseLoopSignature ? findLoopGroupEnd(steps, fromIndex) : fromIndex;
    const preserveBeforeDisplayLoopIndex = (baseLoopSignature && fromLoopIndex !== undefined && fromLoopIndex > 0)
        ? fromLoopIndex + 1
        : undefined;

    interface OutputRule {
        stepIndex: number;
        matchers: RegExp[];
        hasTemplate: boolean;
    }

    const rules: OutputRule[] = [];
    for (let stepIndex = fromIndex; stepIndex < steps.length; stepIndex += 1) {
        const step = steps[stepIndex];
        for (const output of step.outputs) {
            if (path.isAbsolute(output.path)) {
                continue;
            }
            const normalized = output.path.replace(/\\/g, "/");
            const withoutOutputPrefix = normalized.startsWith("output/")
                ? normalized.slice("output/".length)
                : normalized;
            const hasTemplate = normalized.includes("{{");
            rules.push({
                stepIndex,
                matchers: [pathTemplateToRegex(normalized), pathTemplateToRegex(withoutOutputPrefix)],
                hasTemplate
            });
        }
    }

    for (const file of files) {
        let shouldDelete = false;
        for (const rule of rules) {
            if (!rule.matchers.some((rx) => rx.test(file))) {
                continue;
            }

            if (
                preserveBeforeDisplayLoopIndex !== undefined
                && baseLoopSignature
                && rule.stepIndex >= fromIndex
                && rule.stepIndex <= loopGroupEnd
                && rule.hasTemplate
            ) {
                const parsedName = path.posix.parse(file).name;
                const maybeLoopDisplayIndex = Number(parsedName);
                if (Number.isFinite(maybeLoopDisplayIndex) && maybeLoopDisplayIndex < preserveBeforeDisplayLoopIndex) {
                    // fromLoopIndex より前の反復成果物は残す。
                    continue;
                }
            }

            shouldDelete = true;
            break;
        }

        if (!shouldDelete) {
            continue;
        }
        unlinkSync(path.resolve(outputDir, file));
    }
}

function prepareOutputWorkspace(
    config: PipelineConfig,
    configDir: string,
    projectRoot: string,
    fromStepId: string,
    fromLoopIndex?: number,
    sourceRunId?: string
): void {
    const outputDir = path.resolve(projectRoot, "output");
    const stateRoot = path.resolve(configDir, config.run.stateDir);
    const fromIndex = config.steps.findIndex((step) => step.id === fromStepId);
    if (fromIndex < 0) {
        throw new Error(`fromStepId '${fromStepId}' was not found.`);
    }

    if (fromIndex === 0) {
        clearDirectory(outputDir);
        // 先頭からの新規実行は毎回クリーンに開始する。
        return;
    }

    if (!sourceRunId) {
        // 新規実行でfromStep指定時は、現在outputを検証して足りない場合は停止する。
        validateRequiredPreviousOutputs(config.steps, fromIndex, outputDir, "current output");
        // 既存outputのうち再実行対象ステップ以降だけ消して再計算する。
        removeOutputsForSteps(config.steps, fromIndex, outputDir, fromLoopIndex);
        return;
    }

    const snapshotOutputDir = path.resolve(stateRoot, sourceRunId, "output");
    if (!existsSync(snapshotOutputDir) || !statSync(snapshotOutputDir).isDirectory()) {
        throw new Error(`snapshot outputs not found for runId '${sourceRunId}'.`);
    }

    validateRequiredPreviousOutputs(config.steps, fromIndex, snapshotOutputDir, `snapshot runId=${sourceRunId}`);

    clearDirectory(outputDir);
    cpSync(snapshotOutputDir, outputDir, { recursive: true });
    // 再実行対象ステップ以降の出力は消して、復元元との差分汚染を防ぐ。
    removeOutputsForSteps(config.steps, fromIndex, outputDir, fromLoopIndex);
}

function seedRunSnapshotFromPreparedOutput(projectRoot: string, runArtifactsDir: string): void {
    const outputDir = path.resolve(projectRoot, "output");
    if (!existsSync(outputDir) || !statSync(outputDir).isDirectory()) {
        return;
    }

    // 実行開始時点で既に存在する流用出力も、新runのスナップショットへ引き継ぐ。
    const snapshotOutputDir = path.resolve(runArtifactsDir, "output");
    mkdirSync(snapshotOutputDir, { recursive: true });
    cpSync(outputDir, snapshotOutputDir, { recursive: true });
}

// ループ設定の path/jsonPath からループ回数を算出する。
function resolveStepLoopCount(step: StepSpec, projectRoot: string, variables: Record<string, string | number>): number {
    if (!step.loop) {
        return 1;
    }

    const sourcePath = toProjectAbsolute(projectRoot, renderTemplate(step.loop.path, variables));
    if (!existsSync(sourcePath)) {
        throw new Error(`Loop source output file is missing: ${sourcePath}`);
    }

    const sourceRaw = readFileSync(sourcePath, "utf8");
    const parsed = parseMaybeJson(sourceRaw);
    if (!parsed) {
        throw new Error(`Loop source output is not valid JSON: ${sourcePath}`);
    }

    const resolved = resolveJsonPath(parsed, step.loop.jsonPath);
    if (Array.isArray(resolved)) {
        return resolved.length;
    }
    if (typeof resolved === "number" && Number.isFinite(resolved) && resolved >= 0) {
        return Math.floor(resolved);
    }

    throw new Error(`Loop jsonPath '${step.loop.jsonPath}' must resolve to number or array.`);
}

// 出力値をJSONスキーマで検証する。
function validateOutputSchema(schema: Record<string, unknown>, payload: unknown, outputName: string): void {
    const validate = ajv.compile(schema);
    const ok = validate(payload);
    if (!ok) {
        throw new Error(`Schema validation failed for '${outputName}': ${ajv.errorsText(validate.errors)}`);
    }
}

// ステップで宣言された各出力をファイルへ保存する。
function writeOutputs(
    step: StepSpec,
    rawResponse: string,
    projectRoot: string,
    variables: Record<string, string | number>,
    runArtifactsDir?: string
): Record<string, string> {
    const responseTrimmed = rawResponse.trim();
    const responseJson = parseMaybeJson(responseTrimmed);
    const outputMap: Record<string, string> = {};

    for (const output of step.outputs) {
        let valueToWrite = responseTrimmed;
        let valueForSchema: unknown = valueToWrite;

        if (responseJson && typeof responseJson === "object" && !Array.isArray(responseJson)) {
            const keyed = (responseJson as Record<string, unknown>)[output.name];
            if (keyed !== undefined) {
                valueToWrite = typeof keyed === "string" ? keyed : JSON.stringify(keyed, null, 2);
            }
        }

        if (output.format === "json") {
            const parsed = parseMaybeJson(valueToWrite);
            if (!parsed) {
                throw new Error(`Step '${step.id}' output '${output.name}' expects JSON but received invalid JSON.`);
            }
            valueToWrite = JSON.stringify(parsed, null, 2);
            valueForSchema = parsed;
        }

        if (output.schema) {
            validateOutputSchema(output.schema, valueForSchema, output.name);
        }
        if (output.schemaPath) {
            const schemaPath = toProjectAbsolute(projectRoot, output.schemaPath);
            const schemaText = readFileSync(schemaPath, "utf8");
            validateOutputSchema(JSON.parse(schemaText) as Record<string, unknown>, valueForSchema, output.name);
        }

        const renderedOutputPath = renderTemplate(output.path, variables);
        const fullPath = toProjectAbsolute(projectRoot, renderedOutputPath);
        ensureDirForFile(fullPath);
        writeFileSync(fullPath, valueToWrite, "utf8");

        // runIdごとの履歴参照用に、実行スナップショット配下へも保存する。
        if (runArtifactsDir) {
            const relativeSnapshotPath = path.isAbsolute(renderedOutputPath)
                ? path.join("_absolute", path.basename(renderedOutputPath))
                : renderedOutputPath;
            const artifactPath = path.resolve(runArtifactsDir, relativeSnapshotPath);
            ensureDirForFile(artifactPath);
            writeFileSync(artifactPath, valueToWrite, "utf8");
        }

        outputMap[output.name] = valueToWrite;
    }

    return outputMap;
}

// ステップ出力から動的変数（例: loopCount）を抽出する。
function extractVariables(step: StepSpec, outputMap: Record<string, string>, variables: Record<string, string | number>): void {
    for (const spec of step.extractVars ?? []) {
        if (spec.mode !== "jsonPathArrayLength") {
            throw new Error(`Unsupported extractVars mode in step '${step.id}'.`);
        }
        const outputText = outputMap[spec.fromOutputName];
        if (!outputText) {
            throw new Error(`extractVars source output '${spec.fromOutputName}' not found in step '${step.id}'.`);
        }
        const parsed = parseMaybeJson(outputText);
        if (!parsed) {
            throw new Error(`extractVars source output '${spec.fromOutputName}' is not JSON.`);
        }
        variables[spec.name] = jsonPathArrayLength(parsed, spec.jsonPath);
    }
}

// dry-run 用の決定的な疑似出力を生成する。
function createDryRunResponse(step: StepSpec, prompt: string, model: SupportedModel): string {
    const synthetic: Record<string, unknown> = {
        mode: "dryRun",
        stepId: step.id,
        model,
        prompt,
        note: "This is a dry-run synthetic response."
    };

    if (step.outputs.length === 1 && step.outputs[0].format === "json") {
        const outputName = step.outputs[0].name;
        if (step.id === "step3") {
            return JSON.stringify({ [outputName]: ["candidate-0", "candidate-1", "candidate-2"] }, null, 2);
        }
        if (step.id === "step5") {
            return JSON.stringify({ [outputName]: { targets: [0, 1, 2] } }, null, 2);
        }
        return JSON.stringify({ [outputName]: synthetic }, null, 2);
    }

    if (step.outputs.length > 1) {
        const split: Record<string, unknown> = {};
        for (const output of step.outputs) {
            split[output.name] = output.format === "json" ? synthetic : `[DRY-RUN] ${step.id} -> ${output.name}`;
        }
        return JSON.stringify(split, null, 2);
    }

    if (step.id === "step5") {
        return JSON.stringify({ targets: [0, 1, 2] }, null, 2);
    }

    return `[DRY-RUN]\nmodel=${model}\nstep=${step.id}\n\n${prompt}`;
}

// ループ設定を比較しやすい形へ正規化する。
function getLoopSignature(step: StepSpec): LoopSignature | null {
    if (!step.loop) {
        return null;
    }
    return {
        path: step.loop.path,
        jsonPath: step.loop.jsonPath,
        iteratorVar: step.loop.iteratorVar ?? "loopIndex"
    };
}

// 同一ループグループかどうかをシグネチャで比較する。
function isSameLoopSignature(left: LoopSignature, right: LoopSignature): boolean {
    return left.path === right.path
        && left.jsonPath === right.jsonPath
        && left.iteratorVar === right.iteratorVar;
}

// 連続するループグループの終端インデックスを探す（7-8-9反復用）。
function findLoopGroupEnd(steps: StepSpec[], startIndex: number): number {
    const baseSignature = getLoopSignature(steps[startIndex]);
    if (!baseSignature) {
        return startIndex;
    }

    let endIndex = startIndex;
    for (let i = startIndex + 1; i < steps.length; i += 1) {
        const currentSignature = getLoopSignature(steps[i]);
        if (!currentSignature || !isSameLoopSignature(baseSignature, currentSignature)) {
            break;
        }
        endIndex = i;
    }
    return endIndex;
}

// 1ステップ×1反復を実行し、ログと状態を更新する。
async function executeStepIteration(
    step: StepSpec,
    iteration: number,
    iteratorVar: string,
    state: RuntimeState,
    workingDir: string,
    projectRoot: string,
    config: PipelineConfig,
    dryRun: boolean,
    clients: { copilot: CopilotClient; api?: ApiClient },
    stateStore: StateStore,
    runArtifactsDir: string,
    modelOverrides?: { model?: SupportedModel; stepModels?: Record<string, SupportedModel> },
    shouldCancel?: () => boolean
): Promise<RuntimeState> {
    throwIfCancelled(shouldCancel);

    if (dryRun) {
        const delaySeconds = Number(config.run.dryRunDelaySeconds ?? 0);
        if (delaySeconds > 0) {
            await sleep(Math.floor(delaySeconds * 1000));
            throwIfCancelled(shouldCancel);
        }
    }

    const scopedVars: Record<string, string | number> = {
        ...state.variables,
        [iteratorVar]: iteration + 1
    };

    let nextState: RuntimeState = {
        ...state,
        currentStepId: step.id,
        currentIteration: iteration
    };
    nextState = stateStore.appendLog(nextState, {
        at: new Date().toISOString(),
        stepId: step.id,
        iteration,
        phase: "started",
        message: "Step started"
    });

    const inputVars: Record<string, unknown> = { ...scopedVars };
    for (const input of (step.inputs ?? [])) {
        const inputPath = toProjectAbsolute(projectRoot, renderTemplate(input.path, scopedVars));
        const inputValue = readInputOrThrow(inputPath, input.name);
        inputVars[input.name] = inputValue;
        inputVars[`${input.name}Path`] = inputPath;
    }

    for (const output of step.outputs) {
        inputVars[`${output.name}Path`] = toProjectAbsolute(projectRoot, renderTemplate(output.path, scopedVars));
    }

    const executor = resolveStepExecutor(step);
    const promptTemplate = resolvePromptTemplate(step, projectRoot, executor);
    const promptRaw = renderTemplate(promptTemplate, inputVars);
    const prompt = normalizePromptShape(
        replaceInlineFileContentTokens(
            replaceInlineAbsolutePathTokens(promptRaw, projectRoot),
            projectRoot
        )
    );
    const model = resolveModel(config, step, modelOverrides);

    const response = dryRun
        ? createDryRunResponse(step, prompt, model)
        : (executor === "api"
            ? (await (() => {
                if (!clients.api) {
                    throw new Error(`Step '${step.id}' requires apiProvider, but apiProvider is not configured.`);
                }
                return clients.api.runPrompt(prompt, model);
            })()).stdout
            : (await clients.copilot.runPrompt(prompt, model)).stdout);

    const outputMap = writeOutputs(step, response, projectRoot, scopedVars, runArtifactsDir);
    extractVariables(step, outputMap, nextState.variables);

    return stateStore.appendLog(nextState, {
        at: new Date().toISOString(),
        stepId: step.id,
        iteration,
        phase: "completed",
        message: `Step completed (${dryRun ? "dry-run" : "live"})`
    });
}

// パイプライン本体: 設定検証、ステップ実行、実行状態保存を行う。
export async function runPipeline(options: RunPipelineOptions): Promise<RuntimeState> {
    const { config, configDir } = loadConfig(path.resolve(options.configPath));
    const projectRoot = process.cwd();
    const workingDir = path.isAbsolute(config.workingDirectory)
        ? path.normalize(config.workingDirectory)
        : path.resolve(projectRoot, config.workingDirectory);
    runPreflight(config, projectRoot);
    ensureAdminMode(options.forceAdminMode || Boolean(config.adminMode));

    const runId = nowId();
    const fromStepId = options.fromStepId ?? config.steps[0].id;
    const toStepId = options.toStepId;

    const stepStartIndex = config.steps.findIndex((step) => step.id === fromStepId);
    if (stepStartIndex < 0) {
        throw new Error(`fromStepId '${fromStepId}' was not found.`);
    }
    const stepEndIndex = toStepId
        ? config.steps.findIndex((step) => step.id === toStepId)
        : -1;
    if (toStepId && stepEndIndex < 0) {
        throw new Error(`toStepId '${toStepId}' was not found.`);
    }
    if (stepEndIndex >= 0 && stepEndIndex < stepStartIndex) {
        throw new Error(`toStepId '${toStepId}' must be after or equal to fromStepId '${fromStepId}'.`);
    }

    const fromStepSpec = config.steps[stepStartIndex];
    const toStepSpec = stepEndIndex >= 0 ? config.steps[stepEndIndex] : undefined;

    if (options.fromLoopIndex !== undefined) {
        if (!Number.isInteger(options.fromLoopIndex) || options.fromLoopIndex < 0) {
            throw new Error("fromLoopIndex must be a non-negative integer.");
        }
        if (!fromStepSpec.loop && options.fromLoopIndex !== 0) {
            throw new Error(`fromLoopIndex is only available for loop steps. step='${fromStepId}'`);
        }
    }
    const requestedFromLoopIndex = options.fromLoopIndex ?? 0;

    if (options.toLoopIndex !== undefined) {
        if (!Number.isInteger(options.toLoopIndex) || options.toLoopIndex < 0) {
            throw new Error("toLoopIndex must be a non-negative integer.");
        }
        if (!toStepSpec) {
            throw new Error("toLoopIndex requires toStepId.");
        }
        if (!toStepSpec.loop && options.toLoopIndex !== 0) {
            throw new Error(`toLoopIndex is only available for loop steps. step='${toStepSpec.id}'`);
        }
    }
    const requestedToLoopIndex = options.toLoopIndex;

    if (fromStepId === toStepId
        && fromStepSpec.loop
        && requestedToLoopIndex !== undefined
        && requestedFromLoopIndex > requestedToLoopIndex) {
        throw new Error(`toLoopIndex (${requestedToLoopIndex}) must be greater than or equal to fromLoopIndex (${requestedFromLoopIndex}).`);
    }

    prepareOutputWorkspace(config, configDir, projectRoot, fromStepId, requestedFromLoopIndex, options.sourceRunId);

    const stateStore = new StateStore(configDir, config.run.stateDir, runId);
    const runArtifactsDir = path.resolve(configDir, config.run.stateDir, runId);
    seedRunSnapshotFromPreparedOutput(projectRoot, runArtifactsDir);
    const runtime: RuntimeState = {
        runId,
        phase: "running",
        startedAt: new Date().toISOString(),
        fromStepId,
        fromLoopIndex: fromStepSpec.loop ? requestedFromLoopIndex : undefined,
        toStepId: toStepSpec?.id,
        toLoopIndex: requestedToLoopIndex,
        dryRun: options.dryRun,
        adminMode: options.forceAdminMode || Boolean(config.adminMode),
        logs: [],
        variables: {}
    };
    stateStore.save(runtime);

    const clients = {
        copilot: new CopilotClient(config.provider, workingDir),
        api: config.apiProvider ? new ApiClient(config.apiProvider, workingDir) : undefined
    };
    const modelOverrides = {
        model: options.model,
        stepModels: options.stepModels
    };
    let state = runtime;

    try {
        const isWithinRangeStep = (index: number): boolean => {
            if (stepEndIndex < 0) {
                return true;
            }
            return index <= stepEndIndex;
        };

        const shouldStopAtBoundary = (stepId: string, iteration: number): boolean => {
            if (!toStepId || stepId !== toStepId) {
                return false;
            }
            if (requestedToLoopIndex === undefined) {
                return true;
            }
            return iteration >= requestedToLoopIndex;
        };

        let reachedBoundary = false;

        // 非ループは単独実行、ループは同一設定の連続ステップをグループ実行する。
        for (let index = stepStartIndex; index < config.steps.length;) {
            throwIfCancelled(options.shouldCancel);

            if (!isWithinRangeStep(index)) {
                break;
            }

            const step = config.steps[index];
            if (!step.loop) {
                state = await executeStepIteration(
                    step,
                    0,
                    "loopIndex",
                    state,
                    workingDir,
                    projectRoot,
                    config,
                    options.dryRun,
                    clients,
                    stateStore,
                    runArtifactsDir,
                    modelOverrides,
                    options.shouldCancel
                );
                if (shouldStopAtBoundary(step.id, 0)) {
                    reachedBoundary = true;
                    break;
                }
                index += 1;
                continue;
            }

            const groupEnd = findLoopGroupEnd(config.steps, index);
            const group = config.steps.slice(index, groupEnd + 1);
            const hasToStepInGroup = Boolean(toStepId) && group.some((groupedStep) => groupedStep.id === toStepId);
            const iteratorVar = step.loop.iteratorVar ?? "loopIndex";
            const loopCount = resolveStepLoopCount(step, projectRoot, state.variables);
            const startIteration = index === stepStartIndex ? requestedFromLoopIndex : 0;
            if (startIteration >= loopCount) {
                throw new Error(
                    `fromLoopIndex (${startIteration}) is out of range. loopCount=${loopCount}, step='${step.id}'.`
                );
            }
            if (toStepId && group.some((groupedStep) => groupedStep.id === toStepId) && requestedToLoopIndex !== undefined && requestedToLoopIndex >= loopCount) {
                throw new Error(
                    `toLoopIndex (${requestedToLoopIndex}) is out of range. loopCount=${loopCount}, step='${toStepId}'.`
                );
            }

            for (let iteration = startIteration; iteration < loopCount; iteration += 1) {
                throwIfCancelled(options.shouldCancel);
                for (const groupedStep of group) {
                    const groupedIndex = config.steps.findIndex((s) => s.id === groupedStep.id);
                    if (!isWithinRangeStep(groupedIndex)) {
                        const allowPostToStepWithinSameGroup = hasToStepInGroup
                            && requestedToLoopIndex !== undefined
                            && groupedIndex > stepEndIndex
                            && iteration < requestedToLoopIndex;
                        if (allowPostToStepWithinSameGroup) {
                            // toStep より後続の同一ループステップは、境界より前のiterationのみ実行する。
                        } else {
                            break;
                        }
                    }
                    state = await executeStepIteration(
                        groupedStep,
                        iteration,
                        iteratorVar,
                        state,
                        workingDir,
                        projectRoot,
                        config,
                        options.dryRun,
                        clients,
                        stateStore,
                        runArtifactsDir,
                        modelOverrides,
                        options.shouldCancel
                    );
                    if (shouldStopAtBoundary(groupedStep.id, iteration)) {
                        reachedBoundary = true;
                        break;
                    }
                }
                if (reachedBoundary) {
                    break;
                }
            }

            if (reachedBoundary) {
                break;
            }

            index = groupEnd + 1;
        }

        state = {
            ...state,
            phase: "completed",
            endedAt: new Date().toISOString()
        };
        stateStore.save(state);
        // 完了後は履歴スナップショットを参照する前提で、作業用outputを空に戻す。
        clearDirectory(path.resolve(projectRoot, "output"));
        return state;
    } catch (error) {
        const isCancelled = error instanceof PipelineCancelledError;
        const message = error instanceof Error ? error.message : String(error);
        const failed: RuntimeState = {
            ...state,
            phase: isCancelled ? "cancelled" : "failed",
            endedAt: new Date().toISOString(),
            error: message
        };
        stateStore.save(failed);
        // 異常終了時も作業用outputを残さない。
        clearDirectory(path.resolve(projectRoot, "output"));
        throw error;
    }
}
