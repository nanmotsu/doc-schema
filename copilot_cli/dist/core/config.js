"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
// 非空文字列であることを検証する。
function assertNonEmptyString(value, field) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${field} must be a non-empty string.`);
    }
}
// 実行開始前に、ステップ必須項目を検証する。
function validateStep(step) {
    if (!step.id) {
        throw new Error("Step id is required.");
    }
    if (!step.promptTemplate && !step.promptTemplatePath) {
        throw new Error(`Step '${step.id}' requires promptTemplate or promptTemplatePath.`);
    }
    if (step.inputs && !Array.isArray(step.inputs)) {
        throw new Error(`Step '${step.id}' inputs must be an array when provided.`);
    }
    if (!step.outputs || !Array.isArray(step.outputs) || step.outputs.length === 0) {
        throw new Error(`Step '${step.id}' outputs must be a non-empty array.`);
    }
    for (const output of step.outputs) {
        if (!output.schemaPath && !output.schema) {
            throw new Error(`Step '${step.id}' output '${output.name}' requires schemaPath or schema.`);
        }
    }
    if (step.loop) {
        if (!step.loop.path) {
            throw new Error(`Step '${step.id}' loop.path is required.`);
        }
        if (!step.loop.jsonPath) {
            throw new Error(`Step '${step.id}' loop.jsonPath is required.`);
        }
    }
    if (step.model !== undefined) {
        assertNonEmptyString(step.model, `steps.${step.id}.model`);
    }
}
// 設定JSONを読み込み、構造と意味の両面で検証する。
function loadConfig(configPath) {
    const raw = (0, node_fs_1.readFileSync)(configPath, "utf8");
    const parsed = JSON.parse(raw);
    assertNonEmptyString(parsed.defaultModel, "defaultModel");
    if (parsed.modelEnum && parsed.modelEnum.length > 0) {
        for (const model of parsed.modelEnum) {
            assertNonEmptyString(model, "modelEnum");
        }
    }
    if (!parsed.provider?.executable) {
        throw new Error("provider.executable is required.");
    }
    if (!parsed.provider.args || !Array.isArray(parsed.provider.args)) {
        throw new Error("provider.args must be an array.");
    }
    if (parsed.ui?.progressPollMs !== undefined) {
        if (typeof parsed.ui.progressPollMs !== "number" || !Number.isFinite(parsed.ui.progressPollMs) || parsed.ui.progressPollMs <= 0) {
            throw new Error("ui.progressPollMs must be a positive number.");
        }
    }
    if (!parsed.run?.stateDir) {
        throw new Error("run.stateDir is required.");
    }
    if (parsed.run.dryRunDelaySeconds !== undefined) {
        if (typeof parsed.run.dryRunDelaySeconds !== "number" || !Number.isFinite(parsed.run.dryRunDelaySeconds) || parsed.run.dryRunDelaySeconds < 0) {
            throw new Error("run.dryRunDelaySeconds must be a non-negative number.");
        }
    }
    if (!parsed.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
        throw new Error("steps must be a non-empty array.");
    }
    const hasWildcard = Boolean(parsed.modelEnum?.includes("*"));
    const allowedModels = new Set(parsed.modelEnum && parsed.modelEnum.length > 0 ? parsed.modelEnum : []);
    if (!hasWildcard && allowedModels.size > 0 && !allowedModels.has(parsed.defaultModel)) {
        throw new Error(`defaultModel '${parsed.defaultModel}' is not included in modelEnum.`);
    }
    for (const step of parsed.steps) {
        validateStep(step);
        if (!hasWildcard && step.model && allowedModels.size > 0 && !allowedModels.has(step.model)) {
            throw new Error(`steps.${step.id}.model '${step.model}' is not included in modelEnum.`);
        }
    }
    const configDir = node_path_1.default.dirname(configPath);
    return { config: parsed, configDir };
}
