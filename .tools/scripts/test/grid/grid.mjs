/**
 * テスト仕様グリッド サーバー
 * TEST-*.yaml を表形式で表示・編集し、Ctrl+V で screenshot パスを一括反映する。
 *
 * Usage:
 *   node grid.mjs [specDir]
 *
 * URL:
 *   http://localhost:3344
 */
import { createServer } from "node:http";
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { join, resolve, dirname, relative, sep, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { WORKSPACE } from "../../shared/definitions.mjs";

const _require = createRequire(import.meta.url);
const yaml = _require("js-yaml");

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const HTML_PATH = join(__dirname, "grid.html");
const OUTPUT_MAP_PATH = join(__dirname, "grid_output_dirs.json");
const PORT = 3344;

const argDir = process.argv[2];
const defaultSpecDir = resolve(WORKSPACE, "999_利用ガイド", "テスト結果サンプル");
const SPEC_DIR = resolve(argDir ? argDir : defaultSpecDir);

if (!existsSync(SPEC_DIR)) {
    console.error(`ディレクトリが見つかりません: ${SPEC_DIR}`);
    process.exit(1);
}

function normalizePath(value) {
    return String(value ?? "").replace(/\\/g, "/");
}

function isAbsPath(value) {
    return /^(?:[a-zA-Z]:[\\/]|[\\/]{2}|\/)/.test(value);
}

function isImagePath(pathValue) {
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(pathValue ?? ""));
}

function mimeFromPath(pathValue) {
    const p = String(pathValue ?? "").toLowerCase();
    if (p.endsWith(".png")) return "image/png";
    if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
    if (p.endsWith(".gif")) return "image/gif";
    if (p.endsWith(".webp")) return "image/webp";
    if (p.endsWith(".bmp")) return "image/bmp";
    if (p.endsWith(".svg")) return "image/svg+xml";
    return "application/octet-stream";
}

function resolveOutputDirForView(rawOutputDir, yamlDirAbs) {
    const outputDir = String(rawOutputDir ?? "").trim();
    if (!outputDir) return "";
    if (isAbsPath(outputDir)) return normalizePath(outputDir);
    return normalizePath(resolve(yamlDirAbs, outputDir));
}

function applyOutputDirToScreenshot(rawScreenshot, rawOutputDir) {
    const screenshot = String(rawScreenshot ?? "").trim();
    if (!screenshot) return "";
    if (/^(https?:|file:|data:)/i.test(screenshot) || isAbsPath(screenshot)) {
        return normalizePath(screenshot);
    }

    const outputDir = String(rawOutputDir ?? "").trim();
    if (!outputDir) return normalizePath(screenshot);

    return normalizePath(join(outputDir, screenshot));
}

function resolveOutputDirAbsolute(file, outputDir) {
    const yamlAbs = resolve(SPEC_DIR, file);
    const yamlDirAbs = dirname(yamlAbs);
    return isAbsPath(outputDir)
        ? resolve(outputDir)
        : resolve(yamlDirAbs, outputDir);
}

function resolveScreenshotAbsolutePath(file, screenshot, outputDir) {
    const text = String(screenshot ?? "").trim();
    if (!text) return "";
    if (/^(https?:|data:|file:)/i.test(text)) return "";
    if (isAbsPath(text)) return resolve(text);

    if (outputDir) {
        const outDirAbs = resolveOutputDirAbsolute(file, outputDir);
        return resolve(outDirAbs, text);
    }

    const yamlAbs = resolve(SPEC_DIR, file);
    const yamlDirAbs = dirname(yamlAbs);
    return resolve(yamlDirAbs, text);
}

function getScreenshotPreviewUrl(file, screenshot, outputDir) {
    const text = String(screenshot ?? "").trim();
    if (!text) return "";
    if (/^https?:/i.test(text) || /^data:/i.test(text)) return text;

    const absPath = resolveScreenshotAbsolutePath(file, text, outputDir);
    if (!absPath || !isImagePath(absPath) || !existsSync(absPath)) return "";
    return `/api/image?path=${encodeURIComponent(normalizePath(absPath))}`;
}

function getStepScreenshots(step) {
    const screenshotRaw = step?.evidence?.screenshot;
    return Array.isArray(screenshotRaw)
        ? screenshotRaw.map(v => String(v ?? "").trim()).filter(Boolean)
        : (typeof screenshotRaw === "string" && screenshotRaw.trim() ? [screenshotRaw.trim()] : []);
}

function setStepScreenshots(data, file, stepId, screenshots) {
    const cleaned = screenshots.map(v => String(v ?? "").trim()).filter(Boolean);
    let found = false;

    for (const tc of (data.cases ?? [])) {
        for (const step of (tc.steps ?? [])) {
            if (String(step?.id ?? "") !== stepId) continue;
            found = true;

            if (!step.evidence || typeof step.evidence !== "object") {
                step.evidence = {};
            }

            if (cleaned.length > 0) {
                step.evidence.screenshot = cleaned;
            } else {
                delete step.evidence.screenshot;
            }
        }
    }

    if (!found) {
        throw new Error(`stepId が見つかりません: ${file} / ${stepId}`);
    }
}

function appendImageToStep(data, file, stepId, fileName) {
    for (const tc of (data.cases ?? [])) {
        for (const step of (tc.steps ?? [])) {
            if (String(step?.id ?? "") !== stepId) continue;
            const current = getStepScreenshots(step);
            if (!current.includes(fileName)) current.push(fileName);
            setStepScreenshots(data, file, stepId, current);
            return;
        }
    }
    throw new Error(`stepId が見つかりません: ${file} / ${stepId}`);
}

function deleteImageFromStep(data, file, stepId, imageName) {
    for (const tc of (data.cases ?? [])) {
        for (const step of (tc.steps ?? [])) {
            if (String(step?.id ?? "") !== stepId) continue;
            const current = getStepScreenshots(step).filter(v => v !== imageName);
            setStepScreenshots(data, file, stepId, current);
            return;
        }
    }
    throw new Error(`stepId が見つかりません: ${file} / ${stepId}`);
}

function normalizeStepStatus(status, passedFallback) {
    const raw = String(status ?? "").trim();
    if (["pass", "fail", "pending", "not_run"].includes(raw)) return raw;
    if (typeof passedFallback === "boolean") return passedFallback ? "pass" : "fail";
    return "not_run";
}

function deriveStepStatus(step) {
    const detail = step?.result_detail ?? step?.resulet_detail;
    if (detail && typeof detail === "object") {
        const status = normalizeStepStatus(detail.status, detail.passed);
        return status;
    }
    if (typeof step?.passed === "boolean") return step.passed ? "pass" : "fail";
    return "not_run";
}

function updateStepMeta(data, file, stepId, status, remark, passedFallback) {
    for (const tc of (data.cases ?? [])) {
        for (const step of (tc.steps ?? [])) {
            if (String(step?.id ?? "") !== stepId) continue;

            const detail = {
                status: normalizeStepStatus(status, passedFallback),
                remark: String(remark ?? ""),
            };
            // result_detail に統一して保存（旧項目は除去）
            step.result_detail = detail;
            delete step.resulet_detail;
            delete step.passed;
            delete step.remark;
            return;
        }
    }
    throw new Error(`stepId が見つかりません: ${file} / ${stepId}`);
}

function updateStepEvidenceMemo(data, file, stepId, memo) {
    for (const tc of (data.cases ?? [])) {
        for (const step of (tc.steps ?? [])) {
            if (String(step?.id ?? "") !== stepId) continue;

            if (!step.evidence || typeof step.evidence !== "object") {
                step.evidence = {};
            }

            const text = String(memo ?? "");
            if (text) step.evidence.memo = text;
            else delete step.evidence.memo;
            return;
        }
    }
    throw new Error(`stepId が見つかりません: ${file} / ${stepId}`);
}

function updateCaseTestMetaByStep(data, file, stepId, testedAt, testedBy) {
    for (const tc of (data.cases ?? [])) {
        for (const step of (tc.steps ?? [])) {
            if (String(step?.id ?? "") !== stepId) continue;

            const at = String(testedAt ?? "").trim();
            const by = String(testedBy ?? "").trim();

            if (at) tc.tested_at = at;
            else delete tc.tested_at;

            if (by) tc.tested_by = by;
            else delete tc.tested_by;

            return;
        }
    }
    throw new Error(`stepId が見つかりません: ${file} / ${stepId}`);
}

function parseImageDataUrl(dataUrl) {
    const m = String(dataUrl ?? "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new Error("画像データが不正です");

    const mime = m[1].toLowerCase();
    const base64 = m[2];
    const extMap = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/bmp": "bmp",
        "image/svg+xml": "svg",
    };
    const ext = extMap[mime];
    if (!ext) throw new Error(`未対応の画像形式です: ${mime}`);

    return { ext, buffer: Buffer.from(base64, "base64") };
}

function getYamlFiles() {
    return readdirSync(SPEC_DIR)
        .filter(name => /^TEST-.*\.ya?ml$/i.test(name))
        .sort();
}

function readSpec(file) {
    const abs = join(SPEC_DIR, file);
    const text = readFileSync(abs, "utf-8");
    const data = yaml.load(text, { schema: yaml.JSON_SCHEMA }) ?? {};
    return { abs, data };
}

function writeSpec(absPath, data) {
    const dumped = yaml.dump(data, {
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
    });
    writeFileSync(absPath, dumped, "utf-8");
}

function loadOutputDirMap() {
    if (!existsSync(OUTPUT_MAP_PATH)) return {};
    try {
        const raw = readFileSync(OUTPUT_MAP_PATH, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function saveOutputDirMap(mapObj) {
    writeFileSync(OUTPUT_MAP_PATH, JSON.stringify(mapObj, null, 2), "utf-8");
}

function getOutputMapKey(file) {
    const abs = resolve(SPEC_DIR, file);
    return normalizePath(relative(WORKSPACE, abs));
}

function getConfiguredOutputDir(file, data, outputMap) {
    const key = getOutputMapKey(file);
    const mapped = String(outputMap?.[key] ?? "").trim();
    if (mapped) return mapped;
    // 既存YAMLに outputDir がある場合は互換で読み取りのみ行う
    return String(data?.outputDir ?? "").trim();
}

function assertOutputDirConfigured(file, data, outputMap) {
    const outputDir = getConfiguredOutputDir(file, data, outputMap);
    if (!outputDir) {
        throw new Error(`outputDir 未指定: ${file}`);
    }
    return outputDir;
}

function assertOutputDirExists(file, outputDir) {
    const resolved = resolveOutputDirAbsolute(file, outputDir);

    if (!existsSync(resolved)) {
        throw new Error(`outputDir が存在しません: ${outputDir} (解決先: ${normalizePath(resolved)})`);
    }

    let isDir = false;
    try {
        isDir = statSync(resolved).isDirectory();
    } catch {
        isDir = false;
    }
    if (!isDir) {
        throw new Error(`outputDir がディレクトリではありません: ${outputDir} (解決先: ${normalizePath(resolved)})`);
    }
}

function buildGridData() {
    const files = getYamlFiles();
    const outputMap = loadOutputDirMap();
    const specs = [];
    const rows = [];

    for (const file of files) {
        const { abs, data } = readSpec(file);
        const outputDir = getConfiguredOutputDir(file, data, outputMap);
        const yamlDirAbs = dirname(abs);

        let stepCount = 0;
        for (const tc of (data.cases ?? [])) {
            for (const step of (tc.steps ?? [])) {
                stepCount += 1;
                const screenshots = getStepScreenshots(step);
                const resolvedOutputDir = resolveOutputDirForView(outputDir, yamlDirAbs);
                const screenshot = screenshots[0] ?? "";
                const resolvedScreenshot = screenshot
                    ? applyOutputDirToScreenshot(screenshot, resolvedOutputDir)
                    : "";
                const screenshotItems = screenshots.map(name => ({
                    name,
                    previewUrl: getScreenshotPreviewUrl(file, name, outputDir),
                }));

                rows.push({
                    file,
                    specId: data.id ?? basename(file),
                    caseId: tc.id ?? "",
                    caseTitle: tc.title ?? "",
                    stepId: step.id ?? "",
                    subtitle: step.subtitle ?? "",
                    precondition: step.precondition ?? "",
                    action: step.action ?? "",
                    expected: step.expected ?? "",
                    status: deriveStepStatus(step),
                    remark: step?.result_detail?.remark ?? step?.resulet_detail?.remark ?? step.remark ?? "",
                    testedAt: tc.tested_at ?? "",
                    testedBy: tc.tested_by ?? "",
                    evidenceMemo: step?.evidence?.memo ?? "",
                    screenshot,
                    resolvedScreenshot,
                    screenshots: screenshotItems,
                    outputDir,
                });
            }
        }

        specs.push({
            file,
            specId: data.id ?? basename(file),
            title: data.title ?? "",
            outputDir,
            stepCount,
            preconditions: Array.isArray(data.preconditions) ? data.preconditions : [],
            testData: Array.isArray(data.test_data) ? data.test_data : [],
            absPath: normalizePath(abs),
        });
    }

    return {
        specDir: normalizePath(SPEC_DIR),
        specDirRelative: normalizePath(relative(WORKSPACE, SPEC_DIR)),
        specs,
        rows,
    };
}

function sendJson(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
}

function parseBody(req) {
    return new Promise((resolveBody, rejectBody) => {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
            try {
                resolveBody(body ? JSON.parse(body) : {});
            } catch (e) {
                rejectBody(e);
            }
        });
        req.on("error", rejectBody);
    });
}

function guardFileName(file) {
    if (!file || !/^TEST-.*\.ya?ml$/i.test(file)) return false;
    const abs = resolve(SPEC_DIR, file);
    return abs.startsWith(SPEC_DIR + sep) && existsSync(abs);
}

function updateOutputDir(file, outputDir) {
    if (!guardFileName(file)) throw new Error(`無効なファイル: ${file}`);

    const outputMap = loadOutputDirMap();
    const value = String(outputDir ?? "").trim();
    const key = getOutputMapKey(file);

    if (!value) {
        throw new Error(`outputDir は必須です: ${file}`);
    }

    assertOutputDirExists(file, value);

    outputMap[key] = value;

    saveOutputDirMap(outputMap);
}

function updateStepScreenshot(data, file, stepId, screenshotRaw, outputDir) {
    let found = false;

    for (const tc of (data.cases ?? [])) {
        for (const step of (tc.steps ?? [])) {
            if (String(step?.id ?? "") !== stepId) continue;
            found = true;

            if (!step.evidence || typeof step.evidence !== "object") {
                step.evidence = {};
            }

            const screenshot = applyOutputDirToScreenshot(screenshotRaw, outputDir);
            if (screenshot) step.evidence.screenshot = screenshot;
            else delete step.evidence.screenshot;
        }
    }

    if (!found) {
        throw new Error(`stepId が見つかりません: ${file} / ${stepId}`);
    }
}

function applyScreenshotChanges(changes) {
    const grouped = new Map();
    const outputMap = loadOutputDirMap();

    for (const change of changes) {
        const file = String(change.file ?? "").trim();
        const stepId = String(change.stepId ?? "").trim();
        const screenshotRaw = String(change.screenshot ?? "");

        if (!guardFileName(file)) throw new Error(`無効なファイル: ${file}`);
        if (!stepId) throw new Error("stepId が空です");

        if (!grouped.has(file)) grouped.set(file, []);
        grouped.get(file).push({ stepId, screenshotRaw });
    }

    for (const [file, fileChanges] of grouped.entries()) {
        const abs = resolve(SPEC_DIR, file);
        const { data } = readSpec(file);
        const outputDir = assertOutputDirConfigured(file, data, outputMap);
        assertOutputDirExists(file, outputDir);

        for (const { stepId, screenshotRaw } of fileChanges) {
            updateStepScreenshot(data, file, stepId, screenshotRaw, outputDir);
        }

        writeSpec(abs, data);
    }
}

function findUnreferencedEvidenceFiles() {
    const files = getYamlFiles();
    const outputMap = loadOutputDirMap();
    const candidates = [];
    const scannedOutputDirs = new Set();

    for (const file of files) {
        const { data } = readSpec(file);
        const outputDir = assertOutputDirConfigured(file, data, outputMap);
        assertOutputDirExists(file, outputDir);

        const outDirAbs = resolveOutputDirAbsolute(file, outputDir);
        const outDirKey = normalizePath(outDirAbs);

        // 同一 outputDir を複数 YAML が参照している場合は、参照集合を合算して1回だけ走査
        if (!scannedOutputDirs.has(outDirKey)) {
            scannedOutputDirs.add(outDirKey);
        }
    }

    for (const outDirKey of scannedOutputDirs) {
        const outDirAbs = resolve(outDirKey);

        // 当該 outputDir を参照する YAML すべての screenshot 参照を収集
        const referencedNames = new Set();
        for (const file of files) {
            const { data } = readSpec(file);
            const outputDir = getConfiguredOutputDir(file, data, outputMap);
            if (!outputDir) continue;
            const currentOutDir = normalizePath(resolveOutputDirAbsolute(file, outputDir));
            if (currentOutDir !== outDirKey) continue;

            for (const tc of (data.cases ?? [])) {
                for (const step of (tc.steps ?? [])) {
                    for (const shot of getStepScreenshots(step)) {
                        const name = basename(String(shot ?? "").trim());
                        if (name) referencedNames.add(name);
                    }
                }
            }
        }

        const entries = readdirSync(outDirAbs, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            const fileName = entry.name;
            const abs = resolve(outDirAbs, fileName);
            if (!isImagePath(abs)) continue;
            if (referencedNames.has(fileName)) continue;

            const normalized = normalizePath(abs);
            candidates.push({
                path: normalized,
                name: fileName,
                previewUrl: `/api/image?path=${encodeURIComponent(normalized)}`,
            });
        }
    }

    return {
        candidateCount: candidates.length,
        candidates,
        scannedOutputDirCount: scannedOutputDirs.size,
    };
}

function cleanupUnreferencedEvidenceFiles() {
    const found = findUnreferencedEvidenceFiles();
    const deletedFiles = [];

    for (const item of found.candidates) {
        const abs = resolve(item.path);
        if (!existsSync(abs)) continue;
        unlinkSync(abs);
        deletedFiles.push(item.path);
    }

    return {
        deletedCount: deletedFiles.length,
        deletedFiles,
        scannedOutputDirCount: found.scannedOutputDirCount,
    };
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (url.pathname === "/") {
        try {
            const html = readFileSync(HTML_PATH, "utf-8");
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(html);
        } catch (e) {
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(String(e.message ?? e));
        }
        return;
    }

    if (url.pathname === "/api/data" && req.method === "GET") {
        try {
            sendJson(res, 200, buildGridData());
        } catch (e) {
            sendJson(res, 500, { error: String(e.message ?? e) });
        }
        return;
    }

    if (url.pathname === "/api/spec-output-dir" && req.method === "PATCH") {
        try {
            const body = await parseBody(req);
            updateOutputDir(body.file, body.outputDir);
            sendJson(res, 200, { ok: true });
        } catch (e) {
            sendJson(res, 400, { error: String(e.message ?? e) });
        }
        return;
    }

    if (url.pathname === "/api/paste" && req.method === "POST") {
        try {
            const body = await parseBody(req);
            const changes = Array.isArray(body.changes) ? body.changes : [];
            if (changes.length === 0) {
                sendJson(res, 400, { error: "changes が空です" });
                return;
            }
            applyScreenshotChanges(changes);
            sendJson(res, 200, { ok: true, updated: changes.length });
        } catch (e) {
            sendJson(res, 400, { error: String(e.message ?? e) });
        }
        return;
    }

    if (url.pathname === "/api/paste-image" && req.method === "POST") {
        try {
            const body = await parseBody(req);
            const file = String(body.file ?? "").trim();
            const stepId = String(body.stepId ?? "").trim();
            const imageDataUrl = String(body.imageDataUrl ?? "").trim();

            if (!guardFileName(file)) throw new Error(`無効なファイル: ${file}`);
            if (!stepId) throw new Error("stepId が空です");
            if (!imageDataUrl) throw new Error("imageDataUrl が空です");

            const outputMap = loadOutputDirMap();
            const abs = resolve(SPEC_DIR, file);
            const { data } = readSpec(file);
            const outputDir = assertOutputDirConfigured(file, data, outputMap);
            assertOutputDirExists(file, outputDir);

            const { ext, buffer } = parseImageDataUrl(imageDataUrl);
            const outDirAbs = resolveOutputDirAbsolute(file, outputDir);
            const fileName = `${stepId}_${Date.now()}_${randomUUID().slice(0, 8)}.${ext}`;
            const outAbs = resolve(outDirAbs, fileName);

            writeFileSync(outAbs, buffer);
            appendImageToStep(data, file, stepId, fileName);
            writeSpec(abs, data);

            sendJson(res, 200, {
                ok: true,
                screenshot: applyOutputDirToScreenshot(fileName, outputDir),
                imageName: fileName,
                previewUrl: `/api/image?path=${encodeURIComponent(normalizePath(outAbs))}`,
            });
        } catch (e) {
            sendJson(res, 400, { error: String(e.message ?? e) });
        }
        return;
    }

    if (url.pathname === "/api/step-meta" && req.method === "POST") {
        try {
            const body = await parseBody(req);
            const file = String(body.file ?? "").trim();
            const stepId = String(body.stepId ?? "").trim();

            if (!guardFileName(file)) throw new Error(`無効なファイル: ${file}`);
            if (!stepId) throw new Error("stepId が空です");

            const abs = resolve(SPEC_DIR, file);
            const { data } = readSpec(file);
            updateStepMeta(data, file, stepId, body.status, body.remark, body.passed);
            updateCaseTestMetaByStep(data, file, stepId, body.testedAt, body.testedBy);
            writeSpec(abs, data);

            sendJson(res, 200, { ok: true });
        } catch (e) {
            sendJson(res, 400, { error: String(e.message ?? e) });
        }
        return;
    }

    if (url.pathname === "/api/evidence-memo" && req.method === "POST") {
        try {
            const body = await parseBody(req);
            const file = String(body.file ?? "").trim();
            const stepId = String(body.stepId ?? "").trim();

            if (!guardFileName(file)) throw new Error(`無効なファイル: ${file}`);
            if (!stepId) throw new Error("stepId が空です");

            const abs = resolve(SPEC_DIR, file);
            const { data } = readSpec(file);
            updateStepEvidenceMemo(data, file, stepId, body.memo);
            writeSpec(abs, data);

            sendJson(res, 200, { ok: true });
        } catch (e) {
            sendJson(res, 400, { error: String(e.message ?? e) });
        }
        return;
    }

    if (url.pathname === "/api/cleanup-unreferenced-preview" && req.method === "GET") {
        try {
            const result = findUnreferencedEvidenceFiles();
            sendJson(res, 200, { ok: true, ...result });
        } catch (e) {
            sendJson(res, 400, { error: String(e.message ?? e) });
        }
        return;
    }

    if (url.pathname === "/api/cleanup-unreferenced" && req.method === "POST") {
        try {
            const result = cleanupUnreferencedEvidenceFiles();
            sendJson(res, 200, { ok: true, ...result });
        } catch (e) {
            sendJson(res, 400, { error: String(e.message ?? e) });
        }
        return;
    }

    if (url.pathname === "/api/delete-image" && req.method === "POST") {
        try {
            const body = await parseBody(req);
            const file = String(body.file ?? "").trim();
            const stepId = String(body.stepId ?? "").trim();
            const imageName = String(body.imageName ?? "").trim();

            if (!guardFileName(file)) throw new Error(`無効なファイル: ${file}`);
            if (!stepId) throw new Error("stepId が空です");
            if (!imageName) throw new Error("imageName が空です");

            const outputMap = loadOutputDirMap();
            const abs = resolve(SPEC_DIR, file);
            const { data } = readSpec(file);
            const outputDir = assertOutputDirConfigured(file, data, outputMap);
            assertOutputDirExists(file, outputDir);

            deleteImageFromStep(data, file, stepId, imageName);
            writeSpec(abs, data);

            // 安全性のため、実ファイルは削除せず YAML の参照のみ解除する
            sendJson(res, 200, { ok: true, detachedOnly: true });
        } catch (e) {
            sendJson(res, 400, { error: String(e.message ?? e) });
        }
        return;
    }

    if (url.pathname === "/api/image" && req.method === "GET") {
        try {
            const rawPath = String(url.searchParams.get("path") ?? "").trim();
            if (!rawPath) {
                res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
                res.end("path が空です");
                return;
            }

            const absPath = resolve(rawPath);
            if (!isImagePath(absPath) || !existsSync(absPath) || !statSync(absPath).isFile()) {
                res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
                res.end("画像が見つかりません");
                return;
            }

            const bin = readFileSync(absPath);
            res.writeHead(200, {
                "Content-Type": mimeFromPath(absPath),
                "Cache-Control": "no-store",
            });
            res.end(bin);
        } catch (e) {
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(String(e.message ?? e));
        }
        return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
});

server.listen(PORT, () => {
    console.log(`\nテスト仕様グリッド: http://localhost:${PORT}`);
    console.log(`対象ディレクトリ: ${SPEC_DIR}`);
    console.log("Ctrl+C で停止\n");
});
