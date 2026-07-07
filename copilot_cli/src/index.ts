import path from "node:path";
import { loadConfig } from "./core/config";
import { runPipeline } from "./core/engine";
import { startUiServer } from "./services/uiServer";

// スクリプト名の後ろに続くCLI引数。
interface CliArgs {
    configPath: string;
    fromStepId?: string;
    fromLoopIndex?: number;
    toStepId?: string;
    toLoopIndex?: number;
    dryRun: boolean;
    admin: boolean;
    mode: "run" | "ui";
}

// run/uiモードと実行オプションをコマンドライン引数から解釈する。
function parseArgs(argv: string[]): CliArgs {
    const args = [...argv];
    let mode: "run" | "ui" = "run";
    if (args[0] === "run" || args[0] === "ui") {
        mode = args.shift() as "run" | "ui";
    }

    let configPath = "config/pipeline.json";
    let fromStepId: string | undefined;
    let fromLoopIndex: number | undefined;
    let toStepId: string | undefined;
    let toLoopIndex: number | undefined;
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
        if (token === "--loop-index") {
            const rawValue = args[i + 1];
            const parsed = Number(rawValue);
            if (!Number.isInteger(parsed) || parsed < 0) {
                throw new Error("--loop-index must be a non-negative integer.");
            }
            fromLoopIndex = parsed;
            i += 1;
            continue;
        }
        if (token === "--to") {
            toStepId = args[i + 1];
            i += 1;
            continue;
        }
        if (token === "--to-loop-index") {
            const rawValue = args[i + 1];
            const parsed = Number(rawValue);
            if (!Number.isInteger(parsed) || parsed < 0) {
                throw new Error("--to-loop-index must be a non-negative integer.");
            }
            toLoopIndex = parsed;
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
        fromLoopIndex,
        toStepId,
        toLoopIndex,
        dryRun,
        admin,
        mode
    };
}

// エントリポイント: UI起動またはパイプライン実行を切り替える。
async function main(): Promise<void> {
    const parsed = parseArgs(process.argv.slice(2));
    const configPath = path.resolve(parsed.configPath);
    const { config, configDir } = loadConfig(configPath);

    if (parsed.mode === "ui") {
        startUiServer({
            workspaceDir: process.cwd(),
            configPath,
            config,
            configDir
        });
        return;
    }

    const state = await runPipeline({
        configPath,
        fromStepId: parsed.fromStepId,
        fromLoopIndex: parsed.fromLoopIndex,
        toStepId: parsed.toStepId,
        toLoopIndex: parsed.toLoopIndex,
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
