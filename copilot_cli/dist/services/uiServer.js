"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startUiServer = startUiServer;
const express_1 = __importDefault(require("express"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const engine_1 = require("../core/engine");
// 相対パスを安全に解決し、基準ディレクトリ外への遷移を防ぐ。
function safeJoin(base, targetRelative) {
    const resolved = node_path_1.default.resolve(base, targetRelative);
    if (!resolved.startsWith(node_path_1.default.resolve(base))) {
        throw new Error("Invalid path traversal.");
    }
    return resolved;
}
// UI表示用に出力ファイル一覧を再帰的に収集する。
function walkFiles(dir, rootDir, acc) {
    if (!(0, node_fs_1.existsSync)(dir)) {
        return;
    }
    const entries = (0, node_fs_1.readdirSync)(dir);
    for (const entry of entries) {
        const full = node_path_1.default.join(dir, entry);
        const st = (0, node_fs_1.statSync)(full);
        if (st.isDirectory()) {
            walkFiles(full, rootDir, acc);
        }
        else {
            acc.push(node_path_1.default.relative(rootDir, full).replace(/\\/g, "/"));
        }
    }
}
function listRunIds(runsRoot) {
    if (!(0, node_fs_1.existsSync)(runsRoot)) {
        return [];
    }
    return (0, node_fs_1.readdirSync)(runsRoot)
        .filter((name) => {
        const full = node_path_1.default.join(runsRoot, name);
        return (0, node_fs_1.statSync)(full).isDirectory();
    })
        .sort()
        .reverse();
}
function readRunState(runsRoot, runId) {
    const stateFile = node_path_1.default.join(runsRoot, runId, "state.json");
    if (!(0, node_fs_1.existsSync)(stateFile)) {
        return null;
    }
    return JSON.parse((0, node_fs_1.readFileSync)(stateFile, "utf8"));
}
function readLatestRunState(runsRoot) {
    const runIds = listRunIds(runsRoot);
    for (const runId of runIds) {
        const state = readRunState(runsRoot, runId);
        if (state) {
            return state;
        }
    }
    return null;
}
// runId指定時はその実行スナップショット配下を、未指定時は現在出力を参照する。
function resolveOutputBaseDir(reqRunId, runsRoot, projectRoot) {
    const currentOutputDir = node_path_1.default.resolve(projectRoot, "output");
    if (!reqRunId || reqRunId === "__new__" || reqRunId === "__latest__") {
        return currentOutputDir;
    }
    const runSnapshotDir = node_path_1.default.resolve(runsRoot, reqRunId, "output");
    if ((0, node_fs_1.existsSync)(runSnapshotDir) && (0, node_fs_1.statSync)(runSnapshotDir).isDirectory()) {
        return runSnapshotDir;
    }
    return runSnapshotDir;
}
// 静的UI配信と実行状態参照APIを起動する。
function startUiServer(options) {
    const app = (0, express_1.default)();
    const port = options.config.ui?.port ?? 4173;
    const projectRoot = options.workspaceDir;
    const runsRoot = node_path_1.default.resolve(options.configDir, options.config.run.stateDir);
    const publicDir = node_path_1.default.resolve(options.workspaceDir, "public");
    let isRunning = false;
    let cancelRequested = false;
    // UI側の進捗計算に使うステップ情報を返す。
    app.get("/api/pipeline", (_req, res) => {
        return res.json({
            progressPollMs: options.config.ui?.progressPollMs ?? 3000,
            steps: options.config.steps.map((step) => ({
                id: step.id,
                hasLoop: Boolean(step.loop),
                loopIteratorVar: step.loop?.iteratorVar ?? "loopIndex",
                outputs: step.outputs.map((output) => ({
                    name: output.name,
                    path: output.path
                }))
            }))
        });
    });
    app.use(express_1.default.json());
    app.use(express_1.default.static(publicDir, {
        setHeaders: (res) => {
            res.setHeader("Cache-Control", "no-store");
        }
    }));
    // ダッシュボード上部で使う最新実行状態。
    app.get("/api/runtime", (_req, res) => {
        const latest = readLatestRunState(runsRoot);
        if (!latest) {
            return res.json(null);
        }
        return res.json(latest);
    });
    // 実行ごとのスナップショットから直近履歴を返す。
    app.get("/api/runs", (_req, res) => {
        const runIds = listRunIds(runsRoot).slice(0, 20);
        const runs = runIds
            .map((runId) => {
            return readRunState(runsRoot, runId);
        })
            .filter(Boolean);
        return res.json(runs);
    });
    // workingDirectory/output 配下の出力ファイル一覧。
    app.get("/api/outputs", (_req, res) => {
        const runId = typeof _req.query.runId === "string" ? _req.query.runId : "";
        const files = [];
        const outputBaseDir = resolveOutputBaseDir(runId, runsRoot, projectRoot);
        walkFiles(outputBaseDir, outputBaseDir, files);
        return res.json(files);
    });
    // ファイルビューアで使う出力ファイル本文取得API。
    app.get("/api/output", (req, res) => {
        const relative = typeof req.query.path === "string" ? req.query.path : "";
        const runId = typeof req.query.runId === "string" ? req.query.runId : "";
        if (!relative) {
            return res.status(400).json({ error: "path query is required" });
        }
        try {
            const outputBaseDir = resolveOutputBaseDir(runId, runsRoot, projectRoot);
            const full = safeJoin(outputBaseDir, relative);
            if (!(0, node_fs_1.existsSync)(full) || (0, node_fs_1.statSync)(full).isDirectory()) {
                return res.status(404).json({ error: "output file not found" });
            }
            const content = (0, node_fs_1.readFileSync)(full, "utf8");
            return res.json({ path: relative, content });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "unknown";
            return res.status(400).json({ error: message });
        }
    });
    // 実行ボタン状態表示用の制御情報。
    app.get("/api/control", (_req, res) => {
        return res.json({ isRunning, cancelRequested });
    });
    // UIボタンからパイプライン実行を開始する。
    app.post("/api/run", async (req, res) => {
        if (isRunning) {
            return res.status(409).json({ error: "別の実行が進行中です。" });
        }
        const dryRun = Boolean(req.body?.dryRun);
        const fromStepId = typeof req.body?.fromStepId === "string" && req.body.fromStepId.trim()
            ? req.body.fromStepId.trim()
            : undefined;
        const sourceRunId = typeof req.body?.sourceRunId === "string" && req.body.sourceRunId.trim()
            ? req.body.sourceRunId.trim()
            : undefined;
        const forceAdminMode = Boolean(req.body?.admin);
        const model = typeof req.body?.model === "string" && req.body.model.trim().length > 0
            ? req.body.model.trim()
            : undefined;
        const rawStepModels = req.body?.stepModels;
        const stepModels = rawStepModels && typeof rawStepModels === "object"
            ? Object.fromEntries(Object.entries(rawStepModels)
                .filter(([key, value]) => typeof key === "string" && typeof value === "string" && value.trim().length > 0)
                .map(([key, value]) => [key, String(value).trim()]))
            : undefined;
        isRunning = true;
        cancelRequested = false;
        void (0, engine_1.runPipeline)({
            configPath: options.configPath,
            fromStepId,
            dryRun,
            forceAdminMode,
            sourceRunId,
            model,
            stepModels,
            shouldCancel: () => cancelRequested
        }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`Pipeline run failed: ${message}\n`);
        }).finally(() => {
            isRunning = false;
            cancelRequested = false;
        });
        return res.status(202).json({ ok: true, message: "実行を開始しました。" });
    });
    // 実行中ジョブへキャンセル要求を送る。
    app.post("/api/cancel", (_req, res) => {
        if (!isRunning) {
            return res.status(409).json({ error: "実行中のジョブがありません。" });
        }
        cancelRequested = true;
        return res.json({ ok: true, message: "キャンセル要求を受け付けました。" });
    });
    app.listen(port, () => {
        process.stdout.write(`UI server started: http://localhost:${port}\n`);
    });
}
