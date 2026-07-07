import { existsSync } from "node:fs";
import path from "node:path";
import type { PipelineConfig, StepExecutor, StepSpec } from "../core/types";

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
        const full = path.isAbsolute(candidate)
            ? path.normalize(candidate)
            : path.resolve(projectRoot, candidate);
        if (existsSync(full)) {
            return candidate;
        }
    }
    return undefined;
}

function resolvePromptPathByExecutor(step: StepSpec, executor: StepExecutor, projectRoot: string): string | undefined {
    const suffixed = step.promptTemplatePath
        ? withPromptSuffix(step.promptTemplatePath, executor)
        : undefined;
    if (executor === "copilot") {
        return step.promptTemplatePathCopilot
            ?? pickExistingPromptPath(projectRoot, [suffixed, step.promptTemplatePath])
            ?? step.promptTemplatePath;
    }
    return step.promptTemplatePathApi
        ?? pickExistingPromptPath(projectRoot, [suffixed, step.promptTemplatePath])
        ?? step.promptTemplatePath;
}

function resolveSuffixedPromptPath(step: StepSpec, executor: StepExecutor): string | undefined {
    if (!step.promptTemplatePath) {
        return undefined;
    }
    return withPromptSuffix(step.promptTemplatePath, executor);
}

// 設定の実行可否を事前に確認し、起動前に不整合を止める。
export function runPreflight(config: PipelineConfig, projectRoot: string): void {
    const errors: string[] = [];
    const hasApiStep = config.steps.some((step) => resolveStepExecutor(step) === "api");

    if (hasApiStep && !config.apiProvider) {
        errors.push("api executor を使う step があるため apiProvider が必要です。");
    }

    for (const step of config.steps) {
        const executor = resolveStepExecutor(step);
        const hasInlinePrompt = typeof step.promptTemplate === "string" && step.promptTemplate.trim().length > 0;
        const requiredSuffixedPath = resolveSuffixedPromptPath(step, executor);
        if (!requiredSuffixedPath) {
            errors.push(
                `step '${step.id}': suffix policy requires promptTemplatePath and executor-specific file (.${executor})`
            );
        } else {
            const fullRequiredSuffixedPath = path.isAbsolute(requiredSuffixedPath)
                ? path.normalize(requiredSuffixedPath)
                : path.resolve(projectRoot, requiredSuffixedPath);
            if (!existsSync(fullRequiredSuffixedPath)) {
                errors.push(
                    `step '${step.id}': required executor prompt not found: ${fullRequiredSuffixedPath}`
                );
            }
        }

        const configuredPromptPath = resolvePromptPathByExecutor(step, executor, projectRoot);
        const promptPath = pickExistingPromptPath(projectRoot, [configuredPromptPath]);

        if (!hasInlinePrompt && !configuredPromptPath) {
            errors.push(`step '${step.id}': executor='${executor}' 用の promptTemplate がありません。`);
        }

        if (configuredPromptPath && !promptPath) {
            const fullPromptPath = path.isAbsolute(configuredPromptPath)
                ? path.normalize(configuredPromptPath)
                : path.resolve(projectRoot, configuredPromptPath);
            if (!existsSync(fullPromptPath)) {
                errors.push(`step '${step.id}': prompt template not found: ${fullPromptPath}`);
            }
        }

        if (executor === "api" && step.requiresWorkspaceMutation) {
            errors.push(`step '${step.id}': requiresWorkspaceMutation=true は executor='api' と併用できません。`);
        }
        if (executor === "api" && step.requiresCommandExecution) {
            errors.push(`step '${step.id}': requiresCommandExecution=true は executor='api' と併用できません。`);
        }
    }

    if (errors.length > 0) {
        throw new Error(`Preflight failed:\n${errors.map((line) => `- ${line}`).join("\n")}`);
    }
}
