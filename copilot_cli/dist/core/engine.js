"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPipeline = runPipeline;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const ajv_1 = __importDefault(require("ajv"));
const config_1 = require("./config");
const jsonPath_1 = require("./jsonPath");
const state_1 = require("./state");
const template_1 = require("./template");
const admin_1 = require("../services/admin");
const copilotClient_1 = require("../services/copilotClient");
const ajv = new ajv_1.default({ allErrors: true });
class PipelineCancelledError extends Error {
    constructor() {
        super("Execution cancelled by user.");
        this.name = "PipelineCancelledError";
    }
}
// タイムスタンプからファイル名安全な runId を生成する。
function nowId() {
    return new Date().toISOString().replace(/[.:]/g, "-");
}
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
// 必須入力を読み込み、無ければパス付きで即失敗させる。
function readInputOrThrow(fullPath, inputName) {
    if (!(0, node_fs_1.existsSync)(fullPath)) {
        throw new Error(`Required input '${inputName}' not found at ${fullPath}.`);
    }
    return (0, node_fs_1.readFileSync)(fullPath, "utf8");
}
// 例外を投げずに安全にJSONパースする。
function parseMaybeJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
// プロジェクトルート相対パスを絶対パスへ変換する。
function toProjectAbsolute(projectRoot, maybeRelativePath) {
    if (node_path_1.default.isAbsolute(maybeRelativePath)) {
        return node_path_1.default.normalize(maybeRelativePath);
    }
    return node_path_1.default.resolve(projectRoot, maybeRelativePath);
}
// ステップのテンプレート本文を取得する（外部ファイル対応）。
function resolvePromptTemplate(step, projectRoot) {
    if (step.promptTemplatePath) {
        const templatePath = toProjectAbsolute(projectRoot, step.promptTemplatePath);
        if (!(0, node_fs_1.existsSync)(templatePath)) {
            throw new Error(`Step '${step.id}' promptTemplatePath not found: ${templatePath}`);
        }
        return (0, node_fs_1.readFileSync)(templatePath, "utf8");
    }
    return step.promptTemplate ?? "";
}
// テンプレート内 {{absPath:relative/path.txt}} を絶対パスへ展開する。
function replaceInlineAbsolutePathTokens(text, projectRoot) {
    return text.replace(/\{\{\s*absPath:([^}]+)\s*\}\}/g, (_all, relativePath) => {
        return toProjectAbsolute(projectRoot, relativePath.trim());
    });
}
// テンプレート内 {{file:relative/path.txt}} をファイル内容へ展開する。
function replaceInlineFileContentTokens(text, projectRoot) {
    return text.replace(/\{\{\s*file:([^}]+)\s*\}\}/g, (_all, relativePath) => {
        const fullPath = toProjectAbsolute(projectRoot, relativePath.trim());
        if (!(0, node_fs_1.existsSync)(fullPath)) {
            throw new Error(`file token path not found: ${fullPath}`);
        }
        return (0, node_fs_1.readFileSync)(fullPath, "utf8");
    });
}
// ユーザ指定テンプレートが既定見出しを含むか判定する。
function hasPromptSections(text) {
    return text.includes("## 目的")
        && text.includes("## 入力")
        && text.includes("## 出力")
        && text.includes("## 制約");
}
// プロンプトを既定の「目的/入力/出力/制約」形式へ正規化する。
function normalizePromptShape(renderedPrompt) {
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
function throwIfCancelled(shouldCancel) {
    if (shouldCancel && shouldCancel()) {
        throw new PipelineCancelledError();
    }
}
// ステップモデルを解決し、未指定なら defaultModel を使う。
function resolveModel(config, step, overrides) {
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
function ensureDirForFile(filePath) {
    (0, node_fs_1.mkdirSync)(node_path_1.default.dirname(filePath), { recursive: true });
}
function clearDirectory(dir) {
    (0, node_fs_1.rmSync)(dir, { recursive: true, force: true });
    (0, node_fs_1.mkdirSync)(dir, { recursive: true });
}
function walkFiles(rootDir) {
    if (!(0, node_fs_1.existsSync)(rootDir)) {
        return [];
    }
    const acc = [];
    const walk = (dir) => {
        const entries = (0, node_fs_1.readdirSync)(dir);
        for (const entry of entries) {
            const full = node_path_1.default.join(dir, entry);
            const st = (0, node_fs_1.statSync)(full);
            if (st.isDirectory()) {
                walk(full);
                continue;
            }
            acc.push(node_path_1.default.relative(rootDir, full).replace(/\\/g, "/"));
        }
    };
    walk(rootDir);
    return acc;
}
function pathTemplateToRegex(templatePath) {
    const escaped = templatePath
        .replace(/\\/g, "/")
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\{\{[^}]+\}\}/g, "[^/]+");
    return new RegExp(`^${escaped}$`);
}
function hasMatchingOutputFile(outputRoot, outputPathPattern) {
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
function validateRequiredPreviousOutputs(steps, fromIndex, outputRoot, sourceLabel) {
    const missing = [];
    for (const step of steps.slice(0, fromIndex)) {
        for (const output of step.outputs) {
            if (!hasMatchingOutputFile(outputRoot, output.path)) {
                missing.push(`${step.id}.${output.name} (${output.path})`);
            }
        }
    }
    if (missing.length > 0) {
        throw new Error(`fromStepId より前の出力が不足しています: ${sourceLabel}\n`
            + missing.map((entry) => `- ${entry}`).join("\n"));
    }
}
function removeOutputsForSteps(steps, fromIndex, outputDir) {
    const files = walkFiles(outputDir);
    const patterns = steps
        .slice(fromIndex)
        .flatMap((step) => step.outputs.map((output) => output.path))
        .filter((p) => !node_path_1.default.isAbsolute(p))
        .map((p) => pathTemplateToRegex(p));
    for (const file of files) {
        if (!patterns.some((rx) => rx.test(file))) {
            continue;
        }
        (0, node_fs_1.unlinkSync)(node_path_1.default.resolve(outputDir, file));
    }
}
function prepareOutputWorkspace(config, configDir, projectRoot, fromStepId, sourceRunId) {
    const outputDir = node_path_1.default.resolve(projectRoot, "output");
    const stateRoot = node_path_1.default.resolve(configDir, config.run.stateDir);
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
        removeOutputsForSteps(config.steps, fromIndex, outputDir);
        return;
    }
    const snapshotOutputDir = node_path_1.default.resolve(stateRoot, sourceRunId, "output");
    if (!(0, node_fs_1.existsSync)(snapshotOutputDir) || !(0, node_fs_1.statSync)(snapshotOutputDir).isDirectory()) {
        throw new Error(`snapshot outputs not found for runId '${sourceRunId}'.`);
    }
    validateRequiredPreviousOutputs(config.steps, fromIndex, snapshotOutputDir, `snapshot runId=${sourceRunId}`);
    clearDirectory(outputDir);
    (0, node_fs_1.cpSync)(snapshotOutputDir, outputDir, { recursive: true });
    // 再実行対象ステップ以降の出力は消して、復元元との差分汚染を防ぐ。
    removeOutputsForSteps(config.steps, fromIndex, outputDir);
}
function seedRunSnapshotFromPreparedOutput(projectRoot, runArtifactsDir) {
    const outputDir = node_path_1.default.resolve(projectRoot, "output");
    if (!(0, node_fs_1.existsSync)(outputDir) || !(0, node_fs_1.statSync)(outputDir).isDirectory()) {
        return;
    }
    // 実行開始時点で既に存在する流用出力も、新runのスナップショットへ引き継ぐ。
    const snapshotOutputDir = node_path_1.default.resolve(runArtifactsDir, "output");
    (0, node_fs_1.mkdirSync)(snapshotOutputDir, { recursive: true });
    (0, node_fs_1.cpSync)(outputDir, snapshotOutputDir, { recursive: true });
}
// ループ設定の path/jsonPath からループ回数を算出する。
function resolveStepLoopCount(step, projectRoot, variables) {
    if (!step.loop) {
        return 1;
    }
    const sourcePath = toProjectAbsolute(projectRoot, (0, template_1.renderTemplate)(step.loop.path, variables));
    if (!(0, node_fs_1.existsSync)(sourcePath)) {
        throw new Error(`Loop source output file is missing: ${sourcePath}`);
    }
    const sourceRaw = (0, node_fs_1.readFileSync)(sourcePath, "utf8");
    const parsed = parseMaybeJson(sourceRaw);
    if (!parsed) {
        throw new Error(`Loop source output is not valid JSON: ${sourcePath}`);
    }
    const resolved = (0, jsonPath_1.resolveJsonPath)(parsed, step.loop.jsonPath);
    if (Array.isArray(resolved)) {
        return resolved.length;
    }
    if (typeof resolved === "number" && Number.isFinite(resolved) && resolved >= 0) {
        return Math.floor(resolved);
    }
    throw new Error(`Loop jsonPath '${step.loop.jsonPath}' must resolve to number or array.`);
}
// 出力値をJSONスキーマで検証する。
function validateOutputSchema(schema, payload, outputName) {
    const validate = ajv.compile(schema);
    const ok = validate(payload);
    if (!ok) {
        throw new Error(`Schema validation failed for '${outputName}': ${ajv.errorsText(validate.errors)}`);
    }
}
// ステップで宣言された各出力をファイルへ保存する。
function writeOutputs(step, rawResponse, projectRoot, variables, runArtifactsDir) {
    const responseTrimmed = rawResponse.trim();
    const responseJson = parseMaybeJson(responseTrimmed);
    const outputMap = {};
    for (const output of step.outputs) {
        let valueToWrite = responseTrimmed;
        let valueForSchema = valueToWrite;
        if (responseJson && typeof responseJson === "object" && !Array.isArray(responseJson)) {
            const keyed = responseJson[output.name];
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
            const schemaText = (0, node_fs_1.readFileSync)(schemaPath, "utf8");
            validateOutputSchema(JSON.parse(schemaText), valueForSchema, output.name);
        }
        const renderedOutputPath = (0, template_1.renderTemplate)(output.path, variables);
        const fullPath = toProjectAbsolute(projectRoot, renderedOutputPath);
        ensureDirForFile(fullPath);
        (0, node_fs_1.writeFileSync)(fullPath, valueToWrite, "utf8");
        // runIdごとの履歴参照用に、実行スナップショット配下へも保存する。
        if (runArtifactsDir) {
            const relativeSnapshotPath = node_path_1.default.isAbsolute(renderedOutputPath)
                ? node_path_1.default.join("_absolute", node_path_1.default.basename(renderedOutputPath))
                : renderedOutputPath;
            const artifactPath = node_path_1.default.resolve(runArtifactsDir, relativeSnapshotPath);
            ensureDirForFile(artifactPath);
            (0, node_fs_1.writeFileSync)(artifactPath, valueToWrite, "utf8");
        }
        outputMap[output.name] = valueToWrite;
    }
    return outputMap;
}
// ステップ出力から動的変数（例: loopCount）を抽出する。
function extractVariables(step, outputMap, variables) {
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
        variables[spec.name] = (0, jsonPath_1.jsonPathArrayLength)(parsed, spec.jsonPath);
    }
}
// dry-run 用の決定的な疑似出力を生成する。
function createDryRunResponse(step, prompt, model) {
    const synthetic = {
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
        const split = {};
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
function getLoopSignature(step) {
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
function isSameLoopSignature(left, right) {
    return left.path === right.path
        && left.jsonPath === right.jsonPath
        && left.iteratorVar === right.iteratorVar;
}
// 連続するループグループの終端インデックスを探す（7-8-9反復用）。
function findLoopGroupEnd(steps, startIndex) {
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
async function executeStepIteration(step, iteration, iteratorVar, state, workingDir, projectRoot, config, dryRun, client, stateStore, runArtifactsDir, modelOverrides, shouldCancel) {
    throwIfCancelled(shouldCancel);
    if (dryRun) {
        const delaySeconds = Number(config.run.dryRunDelaySeconds ?? 0);
        if (delaySeconds > 0) {
            await sleep(Math.floor(delaySeconds * 1000));
            throwIfCancelled(shouldCancel);
        }
    }
    const scopedVars = {
        ...state.variables,
        [iteratorVar]: iteration
    };
    let nextState = {
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
    const inputVars = { ...scopedVars };
    for (const input of (step.inputs ?? [])) {
        const inputPath = toProjectAbsolute(projectRoot, (0, template_1.renderTemplate)(input.path, scopedVars));
        const inputValue = readInputOrThrow(inputPath, input.name);
        inputVars[input.name] = inputValue;
        inputVars[`${input.name}Path`] = inputPath;
    }
    for (const output of step.outputs) {
        inputVars[`${output.name}Path`] = toProjectAbsolute(projectRoot, (0, template_1.renderTemplate)(output.path, scopedVars));
    }
    const promptTemplate = resolvePromptTemplate(step, projectRoot);
    const promptRaw = (0, template_1.renderTemplate)(promptTemplate, inputVars);
    const prompt = normalizePromptShape(replaceInlineFileContentTokens(replaceInlineAbsolutePathTokens(promptRaw, projectRoot), projectRoot));
    const model = resolveModel(config, step, modelOverrides);
    const response = dryRun
        ? createDryRunResponse(step, prompt, model)
        : (await client.runPrompt(prompt, model)).stdout;
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
async function runPipeline(options) {
    const { config, configDir } = (0, config_1.loadConfig)(node_path_1.default.resolve(options.configPath));
    const projectRoot = process.cwd();
    const workingDir = node_path_1.default.isAbsolute(config.workingDirectory)
        ? node_path_1.default.normalize(config.workingDirectory)
        : node_path_1.default.resolve(projectRoot, config.workingDirectory);
    (0, admin_1.ensureAdminMode)(options.forceAdminMode || Boolean(config.adminMode));
    const runId = nowId();
    const fromStepId = options.fromStepId ?? config.steps[0].id;
    const stepStartIndex = config.steps.findIndex((step) => step.id === fromStepId);
    if (stepStartIndex < 0) {
        throw new Error(`fromStepId '${fromStepId}' was not found.`);
    }
    prepareOutputWorkspace(config, configDir, projectRoot, fromStepId, options.sourceRunId);
    const stateStore = new state_1.StateStore(configDir, config.run.stateDir, runId);
    const runArtifactsDir = node_path_1.default.resolve(configDir, config.run.stateDir, runId);
    seedRunSnapshotFromPreparedOutput(projectRoot, runArtifactsDir);
    const runtime = {
        runId,
        phase: "running",
        startedAt: new Date().toISOString(),
        fromStepId,
        dryRun: options.dryRun,
        adminMode: options.forceAdminMode || Boolean(config.adminMode),
        logs: [],
        variables: {}
    };
    stateStore.save(runtime);
    const client = new copilotClient_1.CopilotClient(config.provider, workingDir);
    const modelOverrides = {
        model: options.model,
        stepModels: options.stepModels
    };
    let state = runtime;
    try {
        // 非ループは単独実行、ループは同一設定の連続ステップをグループ実行する。
        for (let index = stepStartIndex; index < config.steps.length;) {
            throwIfCancelled(options.shouldCancel);
            const step = config.steps[index];
            if (!step.loop) {
                state = await executeStepIteration(step, 0, "loopIndex", state, workingDir, projectRoot, config, options.dryRun, client, stateStore, runArtifactsDir, modelOverrides, options.shouldCancel);
                index += 1;
                continue;
            }
            const groupEnd = findLoopGroupEnd(config.steps, index);
            const group = config.steps.slice(index, groupEnd + 1);
            const iteratorVar = step.loop.iteratorVar ?? "loopIndex";
            const loopCount = resolveStepLoopCount(step, projectRoot, state.variables);
            for (let iteration = 0; iteration < loopCount; iteration += 1) {
                throwIfCancelled(options.shouldCancel);
                for (const groupedStep of group) {
                    state = await executeStepIteration(groupedStep, iteration, iteratorVar, state, workingDir, projectRoot, config, options.dryRun, client, stateStore, runArtifactsDir, modelOverrides, options.shouldCancel);
                }
            }
            index = groupEnd + 1;
        }
        state = {
            ...state,
            phase: "completed",
            endedAt: new Date().toISOString()
        };
        stateStore.save(state);
        return state;
    }
    catch (error) {
        const isCancelled = error instanceof PipelineCancelledError;
        const message = error instanceof Error ? error.message : String(error);
        const failed = {
            ...state,
            phase: isCancelled ? "cancelled" : "failed",
            endedAt: new Date().toISOString(),
            error: message
        };
        stateStore.save(failed);
        throw error;
    }
}
