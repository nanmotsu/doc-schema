import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { renderTemplate } from "../core/template";
import type { CopilotExecutionResult, ProviderConfig, SupportedModel } from "../core/types";

// {{prompt}} と {{model}} を provider 引数へ展開する。
function applyTemplateToArgs(args: string[], vars: Record<string, string>): string[] {
    return args.map((arg) => renderTemplate(arg, vars));
}

// Windows では copilot が ps1 として配布されるため、PowerShell 経由で実行可能形へ変換する。
function resolveProviderCommand(executable: string, args: string[]): { executable: string; args: string[] } {
    const isWindows = process.platform === "win32";
    if (!isWindows) {
        return { executable, args };
    }

    const normalized = executable.toLowerCase();
    if (normalized !== "copilot" && !normalized.endsWith("copilot.ps1") && !normalized.endsWith("copilot")) {
        return { executable, args };
    }

    const explicitScriptPath = process.env.COPILOT_CLI_PS1_PATH;
    const defaultScriptPath = path.join(
        process.env.APPDATA ?? "",
        "Code",
        "User",
        "globalStorage",
        "github.copilot-chat",
        "copilotCli",
        "copilot.ps1"
    );

    const scriptPath = explicitScriptPath && existsSync(explicitScriptPath)
        ? explicitScriptPath
        : defaultScriptPath;

    if (!existsSync(scriptPath)) {
        return { executable, args };
    }

    return {
        executable: "powershell.exe",
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args]
    };
}

// 外部プロバイダ実行（copilot CLI など）を包む薄いアダプタ。
export class CopilotClient {
    constructor(private readonly provider: ProviderConfig, private readonly workingDirectory: string) { }

    // 1件のプロンプトを非同期実行し、stderr/終了コードを厳密に検査する。
    runPrompt(prompt: string, model: SupportedModel): Promise<CopilotExecutionResult> {
        const renderedArgs = applyTemplateToArgs(this.provider.args, {
            prompt,
            model
        });
        const command = resolveProviderCommand(this.provider.executable, renderedArgs);

        return new Promise<CopilotExecutionResult>((resolve, reject) => {
            const child = spawn(command.executable, command.args, {
                cwd: this.workingDirectory,
                stdio: ["pipe", "pipe", "pipe"]
            });

            let stdout = "";
            let stderr = "";

            child.stdout.setEncoding("utf8");
            child.stderr.setEncoding("utf8");

            child.stdout.on("data", (chunk: string) => {
                stdout += chunk;
            });
            child.stderr.on("data", (chunk: string) => {
                stderr += chunk;
            });

            child.on("error", (error) => {
                reject(new Error(`provider execution failed: ${error.message}`));
            });

            child.on("close", (code) => {
                const exitCode = code ?? 1;
                if (stderr.trim().length > 0) {
                    reject(new Error(`stderr detected from provider: ${stderr.trim()}`));
                    return;
                }
                if (exitCode !== 0) {
                    reject(new Error(`provider exited with code ${exitCode}.`));
                    return;
                }
                if (!stdout.trim()) {
                    reject(new Error("provider returned empty output."));
                    return;
                }

                resolve({
                    stdout,
                    stderr,
                    exitCode
                });
            });

            if (this.provider.useStdinPrompt) {
                child.stdin.write(prompt, "utf8");
            }
            child.stdin.end();
        });
    }
}
