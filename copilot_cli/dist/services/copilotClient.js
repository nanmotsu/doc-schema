"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CopilotClient = void 0;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const template_1 = require("../core/template");
// {{prompt}} と {{model}} を provider 引数へ展開する。
function applyTemplateToArgs(args, vars) {
    return args.map((arg) => (0, template_1.renderTemplate)(arg, vars));
}
// Windows では copilot が ps1 として配布されるため、PowerShell 経由で実行可能形へ変換する。
function resolveProviderCommand(executable, args) {
    const isWindows = process.platform === "win32";
    if (!isWindows) {
        return { executable, args };
    }
    const normalized = executable.toLowerCase();
    if (normalized !== "copilot" && !normalized.endsWith("copilot.ps1") && !normalized.endsWith("copilot")) {
        return { executable, args };
    }
    const explicitScriptPath = process.env.COPILOT_CLI_PS1_PATH;
    const defaultScriptPath = node_path_1.default.join(process.env.APPDATA ?? "", "Code", "User", "globalStorage", "github.copilot-chat", "copilotCli", "copilot.ps1");
    const scriptPath = explicitScriptPath && (0, node_fs_1.existsSync)(explicitScriptPath)
        ? explicitScriptPath
        : defaultScriptPath;
    if (!(0, node_fs_1.existsSync)(scriptPath)) {
        return { executable, args };
    }
    return {
        executable: "powershell.exe",
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args]
    };
}
// 外部プロバイダ実行（copilot CLI など）を包む薄いアダプタ。
class CopilotClient {
    provider;
    workingDirectory;
    constructor(provider, workingDirectory) {
        this.provider = provider;
        this.workingDirectory = workingDirectory;
    }
    // 1件のプロンプトを非同期実行し、stderr/終了コードを厳密に検査する。
    runPrompt(prompt, model) {
        const renderedArgs = applyTemplateToArgs(this.provider.args, {
            prompt,
            model
        });
        const command = resolveProviderCommand(this.provider.executable, renderedArgs);
        return new Promise((resolve, reject) => {
            const child = (0, node_child_process_1.spawn)(command.executable, command.args, {
                cwd: this.workingDirectory,
                stdio: ["pipe", "pipe", "pipe"]
            });
            let stdout = "";
            let stderr = "";
            child.stdout.setEncoding("utf8");
            child.stderr.setEncoding("utf8");
            child.stdout.on("data", (chunk) => {
                stdout += chunk;
            });
            child.stderr.on("data", (chunk) => {
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
exports.CopilotClient = CopilotClient;
