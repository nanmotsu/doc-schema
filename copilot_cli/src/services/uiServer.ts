import express from "express";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { PipelineConfig } from "../core/types";
import { runPipeline } from "../core/engine";

interface UiServerOptions {
    workspaceDir: string;
    configDir: string;
    configPath: string;
    config: PipelineConfig;
}

// 相対パスを安全に解決し、基準ディレクトリ外への遷移を防ぐ。
function safeJoin(base: string, targetRelative: string): string {
    const resolved = path.resolve(base, targetRelative);
    if (!resolved.startsWith(path.resolve(base))) {
        throw new Error("Invalid path traversal.");
    }
    return resolved;
}

// UI表示用に出力ファイル一覧を再帰的に収集する。
function walkFiles(dir: string, rootDir: string, acc: string[]): void {
    if (!existsSync(dir)) {
        return;
    }
    const entries = readdirSync(dir);
    for (const entry of entries) {
        const full = path.join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            walkFiles(full, rootDir, acc);
        } else {
            acc.push(path.relative(rootDir, full).replace(/\\/g, "/"));
        }
    }
}

function listRunIds(runsRoot: string): string[] {
    if (!existsSync(runsRoot)) {
        return [];
    }
    return readdirSync(runsRoot)
        .filter((name) => {
            const full = path.join(runsRoot, name);
            return statSync(full).isDirectory();
        })
        .sort()
        .reverse();
}

function readRunState(runsRoot: string, runId: string): unknown | null {
    const stateFile = path.join(runsRoot, runId, "state.json");
    if (!existsSync(stateFile)) {
        return null;
    }
    return JSON.parse(readFileSync(stateFile, "utf8"));
}

function readLatestRunState(runsRoot: string): unknown | null {
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
function resolveOutputBaseDir(
    reqRunId: string,
    runsRoot: string,
    projectRoot: string
): string {
    const currentOutputDir = path.resolve(projectRoot, "output");

    if (!reqRunId || reqRunId === "__new__" || reqRunId === "__latest__") {
        return currentOutputDir;
    }

    const runSnapshotDir = path.resolve(runsRoot, reqRunId, "output");
    if (existsSync(runSnapshotDir) && statSync(runSnapshotDir).isDirectory()) {
        return runSnapshotDir;
    }

    return runSnapshotDir;
}

// 静的UI配信と実行状態参照APIを起動する。
export function startUiServer(options: UiServerOptions): void {
    const app = express();
    const port = options.config.ui?.port ?? 4173;
    const projectRoot = options.workspaceDir;
    const runsRoot = path.resolve(options.configDir, options.config.run.stateDir);
    const publicDir = path.resolve(options.workspaceDir, "public");
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

    app.use(express.json());
    app.use(express.static(publicDir, {
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
        const files: string[] = [];
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
            if (!existsSync(full) || statSync(full).isDirectory()) {
                return res.status(404).json({ error: "output file not found" });
            }
            const content = readFileSync(full, "utf8");
            return res.json({ path: relative, content });
        } catch (error) {
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
        const fromLoopIndexUser = req.body?.fromLoopIndex === undefined || req.body?.fromLoopIndex === null || req.body?.fromLoopIndex === ""
            ? undefined
            : Number(req.body.fromLoopIndex);
        if (fromLoopIndexUser !== undefined && (!Number.isInteger(fromLoopIndexUser) || fromLoopIndexUser < 1)) {
            return res.status(400).json({ error: "fromLoopIndex は 1 以上の整数で指定してください。" });
        }
        const fromLoopIndex = fromLoopIndexUser === undefined ? undefined : fromLoopIndexUser - 1;
        const toStepId = typeof req.body?.toStepId === "string" && req.body.toStepId.trim()
            ? req.body.toStepId.trim()
            : undefined;
        const toLoopIndexUser = req.body?.toLoopIndex === undefined || req.body?.toLoopIndex === null || req.body?.toLoopIndex === ""
            ? undefined
            : Number(req.body.toLoopIndex);
        if (toLoopIndexUser !== undefined && (!Number.isInteger(toLoopIndexUser) || toLoopIndexUser < 1)) {
            return res.status(400).json({ error: "toLoopIndex は 1 以上の整数で指定してください。" });
        }
        const toLoopIndex = toLoopIndexUser === undefined ? undefined : toLoopIndexUser - 1;
        const sourceRunId = typeof req.body?.sourceRunId === "string" && req.body.sourceRunId.trim()
            ? req.body.sourceRunId.trim()
            : undefined;
        const forceAdminMode = Boolean(req.body?.admin);
        const model = typeof req.body?.model === "string" && req.body.model.trim().length > 0
            ? req.body.model.trim()
            : undefined;
        const rawStepModels = req.body?.stepModels;
        const stepModels = rawStepModels && typeof rawStepModels === "object"
            ? Object.fromEntries(
                Object.entries(rawStepModels)
                    .filter(([key, value]) => typeof key === "string" && typeof value === "string" && value.trim().length > 0)
                    .map(([key, value]) => [key, String(value).trim()])
            )
            : undefined;

        isRunning = true;
        cancelRequested = false;

        void runPipeline({
            configPath: options.configPath,
            fromStepId,
            fromLoopIndex,
            toStepId,
            toLoopIndex,
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
