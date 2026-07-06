"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverCopilotModels = discoverCopilotModels;
const node_child_process_1 = require("node:child_process");
function uniq(values) {
    return Array.from(new Set(values.filter((v) => v && v.trim().length > 0)));
}
function parseJsonModels(text) {
    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
            const models = parsed
                .map((item) => {
                if (typeof item === "string") {
                    return item;
                }
                if (item && typeof item === "object") {
                    const rec = item;
                    const candidate = rec.id ?? rec.model ?? rec.name;
                    return typeof candidate === "string" ? candidate : "";
                }
                return "";
            })
                .filter(Boolean);
            return uniq(models);
        }
    }
    catch {
        // noop
    }
    return [];
}
function parseTextModels(text) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const maybeModels = lines
        .map((line) => {
        const token = line.split(/\s+/)[0];
        return token;
    })
        .filter((token) => /gpt|claude|gemini|o[1-9]/i.test(token));
    return uniq(maybeModels);
}
function tryListModels(executable, args, cwd) {
    try {
        const result = (0, node_child_process_1.spawnSync)(executable, args, {
            cwd,
            encoding: "utf8",
            timeout: 8000
        });
        if (result.error || (result.status ?? 1) !== 0) {
            return [];
        }
        const stdout = (result.stdout ?? "").toString();
        return args.includes("--json") ? parseJsonModels(stdout) : parseTextModels(stdout);
    }
    catch {
        return [];
    }
}
function discoverCopilotModels(config, cwd) {
    const executable = config.provider.executable;
    const fromJson = tryListModels(executable, ["copilot", "models", "--json"], cwd);
    if (fromJson.length > 0) {
        return fromJson;
    }
    const fromText = tryListModels(executable, ["copilot", "models"], cwd);
    if (fromText.length > 0) {
        return fromText;
    }
    const fromConfig = [
        ...(config.modelEnum ?? []).filter((model) => model !== "*"),
        config.defaultModel,
        ...config.steps.map((step) => step.model).filter((model) => Boolean(model))
    ];
    return uniq(fromConfig);
}
