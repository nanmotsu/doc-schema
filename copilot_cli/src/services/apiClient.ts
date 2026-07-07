import { spawn } from "node:child_process";
import { renderTemplate } from "../core/template";
import type { CopilotExecutionResult, ProviderConfig, SupportedModel } from "../core/types";

function applyTemplateToArgs(args: string[], vars: Record<string, string>): string[] {
    return args.map((arg) => renderTemplate(arg, vars));
}

// API実行用の外部コマンド（例: curl）を呼び出し、stdoutを結果として返す。
export class ApiClient {
    constructor(private readonly provider: ProviderConfig, private readonly workingDirectory: string) { }

    runPrompt(prompt: string, model: SupportedModel): Promise<CopilotExecutionResult> {
        const renderedArgs = applyTemplateToArgs(this.provider.args, {
            prompt,
            model
        });

        return new Promise<CopilotExecutionResult>((resolve, reject) => {
            const child = spawn(this.provider.executable, renderedArgs, {
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
                reject(new Error(`api provider execution failed: ${error.message}`));
            });

            child.on("close", (code) => {
                const exitCode = code ?? 1;
                if (stderr.trim().length > 0) {
                    reject(new Error(`stderr detected from api provider: ${stderr.trim()}`));
                    return;
                }
                if (exitCode !== 0) {
                    reject(new Error(`api provider exited with code ${exitCode}.`));
                    return;
                }
                if (!stdout.trim()) {
                    reject(new Error("api provider returned empty output."));
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
