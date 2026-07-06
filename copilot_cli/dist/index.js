"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./core/config");
const engine_1 = require("./core/engine");
const uiServer_1 = require("./services/uiServer");
// run/uiモードと実行オプションをコマンドライン引数から解釈する。
function parseArgs(argv) {
    const args = [...argv];
    let mode = "run";
    if (args[0] === "run" || args[0] === "ui") {
        mode = args.shift();
    }
    let configPath = "config/pipeline.json";
    let fromStepId;
    let dryRun = false;
    let admin = false;
    for (let i = 0; i < args.length; i += 1) {
        const token = args[i];
        if (token === "--config") {
            configPath = args[i + 1];
            i += 1;
            continue;
        }
        if (token === "--from") {
            fromStepId = args[i + 1];
            i += 1;
            continue;
        }
        if (token === "--dry-run") {
            dryRun = true;
            continue;
        }
        if (token === "--admin") {
            admin = true;
            continue;
        }
    }
    return {
        configPath,
        fromStepId,
        dryRun,
        admin,
        mode
    };
}
// エントリポイント: UI起動またはパイプライン実行を切り替える。
async function main() {
    const parsed = parseArgs(process.argv.slice(2));
    const configPath = node_path_1.default.resolve(parsed.configPath);
    const { config, configDir } = (0, config_1.loadConfig)(configPath);
    if (parsed.mode === "ui") {
        (0, uiServer_1.startUiServer)({
            workspaceDir: process.cwd(),
            configPath,
            config,
            configDir
        });
        return;
    }
    const state = await (0, engine_1.runPipeline)({
        configPath,
        fromStepId: parsed.fromStepId,
        dryRun: parsed.dryRun,
        forceAdminMode: parsed.admin
    });
    process.stdout.write(`Pipeline completed: runId=${state.runId}\n`);
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Pipeline failed: ${message}\n`);
    process.exit(1);
});
