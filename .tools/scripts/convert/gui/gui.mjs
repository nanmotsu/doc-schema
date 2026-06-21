/**
 * Markdown 変換GUIサーバ�E
 * 左: Markdown編雁E/ 右: HTML(PDFライク)プレビュー
 *
 * Usage:
 *   node gui/gui.mjs [baseDir]
 * URL:
 *   http://localhost:3355
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, resolve, dirname, relative, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { marked } from "marked";
import yaml from "js-yaml";
import { WORKSPACE } from "../../shared/definitions.mjs";
import { transformDSL } from "../dsl.mjs";
import {
    loadConvertConfig,
    generateConfigCSS,
    parseFrontmatter,
    isParagraphIndentEnabled,
    parseBoolLike,
    resolveEffectivePageConfig,
    resolveEffectiveStyleConfig,
    resolveDslBodyWithWarnings,
    resolveAssetsBaseAbs,
    resolveCoverPath,
    buildTitlePage,
    buildHeaderFooterOptions,
} from "../render_common.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const _require = createRequire(import.meta.url);
const MERMAID_JS = _require.resolve("mermaid/dist/mermaid.min.js");

const PORT = 3355;
const GUI_HTML_PATH = join(__dirname, "gui.html");
const EDITOR_HIGHLIGHT_THEME_PATH = join(__dirname, "editor_highlight_theme.yaml");

const argDir = process.argv[2];
const defaultBaseDir = resolve(WORKSPACE, "999_利用ガイド", "変換サンプル");
let currentBaseDir = resolve(argDir ? argDir : defaultBaseDir);

if (!existsSync(currentBaseDir)) {
    console.error(`チE��レクトリが見つかりません: ${currentBaseDir}`);
    process.exit(1);
}

const { dslConfig, styleConfig, pageConfig, structureCss } = loadConvertConfig();
marked.setOptions({ gfm: true, breaks: false });

function parseMd(src) {
    return marked.parse(src);
}

function findSystemChrome() {
    const candidates = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ];
    return candidates.find((p) => existsSync(p)) ?? null;
}

function collectMarkdownFiles(dir, out = []) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
            collectMarkdownFiles(abs, out);
            continue;
        }
        if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
            out.push(abs);
        }
    }
    return out;
}

function collectMarkdownDirectories(rootDir) {
    const files = collectMarkdownFiles(rootDir, []);
    const dirs = new Set();
    for (const file of files) dirs.add(dirname(file));
    return [...dirs].sort((a, b) => a.localeCompare(b, "ja"));
}

function toWorkspaceRelative(absPath) {
    return relative(WORKSPACE, absPath).replace(/\\/g, "/");
}

function absFromWorkspaceRelative(relPath) {
    const abs = resolve(WORKSPACE, String(relPath || ""));
    if (!(abs === WORKSPACE || abs.startsWith(WORKSPACE + "\\") || abs.startsWith(WORKSPACE + "/"))) {
        throw new Error("不正なパスです");
    }
    return abs;
}

function mimeToExt(mime, fallback = ".png") {
    const map = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/bmp": ".bmp",
        "image/svg+xml": ".svg",
    };
    return map[String(mime || "").toLowerCase()] || fallback;
}

function uniquePath(absPath) {
    if (!existsSync(absPath)) return absPath;
    const ext = extname(absPath);
    const stem = absPath.slice(0, absPath.length - ext.length);
    for (let i = 1; i < 1000; i++) {
        const next = `${stem}_${i}${ext}`;
        if (!existsSync(next)) return next;
    }
    return `${stem}_${Date.now()}${ext}`;
}

function normalizeFileName(name) {
    const v = String(name || "image").replace(/[\\/:*?"<>|]/g, "_").trim();
    return v || "image";
}

function saveUploadedImage(absMarkdownPath, fileName, dataUrl) {
    const m = String(dataUrl || "").match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new Error("画像データが不正です");

    const mime = m[1].toLowerCase();
    const buf = Buffer.from(m[2], "base64");
    const rawName = normalizeFileName(fileName);
    const rawExt = extname(rawName);
    const ext = rawExt || mimeToExt(mime);
    const stem = rawName.replace(new RegExp(`${rawExt.replace(".", "\\.")}$`), "") || "image";

    const assetsDir = join(dirname(absMarkdownPath), "assets");
    mkdirSync(assetsDir, { recursive: true });
    const outPath = uniquePath(join(assetsDir, `${stem}${ext}`));
    writeFileSync(outPath, buf);

    const rel = relative(dirname(absMarkdownPath), outPath).replace(/\\/g, "/");
    return rel.startsWith(".") ? rel : `./${rel}`;
}

function applyFrontmatter(content, meta) {
    const parsed = parseFrontmatter(content);
    const body = String(parsed.body || "").replace(/^\r?\n/, "");
    const hasMeta = meta && typeof meta === "object" && Object.keys(meta).length > 0;
    if (!hasMeta) return body;

    const dumped = yaml.dump(meta, { lineWidth: -1, noRefs: true }).trimEnd();
    return `---\n${dumped}\n---\n\n${body}`;
}

function isInsideWorkspace(absPath) {
    return absPath === WORKSPACE || absPath.startsWith(WORKSPACE + "\\") || absPath.startsWith(WORKSPACE + "/");
}

function getPaperSizeMm(paper) {
    const key = String(paper || "A4").toUpperCase();
    const map = {
        A4: { w: 210, h: 297 },
        A3: { w: 297, h: 420 },
        LETTER: { w: 216, h: 279 },
        LEGAL: { w: 216, h: 356 },
    };
    return map[key] || map.A4;
}

function resolvePreviewAssetUrl(src, absMarkdownPath) {
    const raw = String(src || "").trim();
    if (!raw) return raw;

    if (/^(?:https?:|data:|blob:|about:|mailto:|tel:|#)/i.test(raw)) return raw;
    if (/^\/api\/asset\?path=/i.test(raw)) return raw;

    if (/^file:\/\//i.test(raw)) {
        try {
            const u = new URL(raw);
            const filePath = decodeURIComponent(u.pathname || "").replace(/^\/+/, "");
            const normalized = filePath.replace(/\//g, "\\");
            const winAbs = /^[A-Za-z]:\\/.test(normalized) ? normalized : `\\${normalized}`;
            const abs = resolve(winAbs);
            if (isInsideWorkspace(abs)) {
                return `/api/asset?path=${encodeURIComponent(toWorkspaceRelative(abs))}`;
            }
        } catch {
            return raw;
        }
        return raw;
    }

    let abs;
    if (/^[A-Za-z]:[\\/]/.test(raw)) {
        abs = resolve(raw);
    } else if (raw.startsWith("/")) {
        abs = resolve(WORKSPACE, raw.replace(/^\/+/, ""));
    } else {
        abs = resolve(dirname(absMarkdownPath), raw);
    }

    if (!isInsideWorkspace(abs)) return raw;
    return `/api/asset?path=${encodeURIComponent(toWorkspaceRelative(abs))}`;
}

function rewritePreviewImageSources(html, absMarkdownPath) {
    return String(html || "").replace(/(<img\b[^>]*\bsrc=)(["'])([^"']+)(\2)/gi, (m, head, q, src, tail) => {
        const nextSrc = resolvePreviewAssetUrl(src, absMarkdownPath);
        return `${head}${q}${nextSrc}${tail}`;
    });
}

function getFileContentType(absPath) {
    const ext = extname(absPath).toLowerCase();
    const map = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".svg": "image/svg+xml",
    };
    return map[ext] || "application/octet-stream";
}

function resolveOutputDir(meta, srcDir, preferredKey) {
    const preferred = meta?.[preferredKey];
    const shared = meta?.outputDir;
    const raw = preferred ?? shared;
    if (raw === undefined || raw === null) return srcDir;
    const text = String(raw).trim();
    if (!text) return srcDir;
    return resolve(srcDir, text);
}

function resolveOutputFileName(meta, key, fallback) {
    const raw = meta?.[key];
    if (raw === undefined || raw === null) return fallback;
    const text = String(raw).trim();
    return text || fallback;
}

function resolveBuildOutputPaths(absMarkdownPath, markdownContent) {
    const srcDir = dirname(absMarkdownPath);
    const baseName = basename(absMarkdownPath, extname(absMarkdownPath));
    const { meta } = parseFrontmatter(markdownContent);

    const htmlDir = resolveOutputDir(meta, srcDir, "htmlOutputDir");
    const pdfDir = resolveOutputDir(meta, srcDir, "pdfOutputDir");
    const htmlFileName = resolveOutputFileName(meta, "htmlFileName", `${baseName}.html`);
    const pdfFileName = resolveOutputFileName(meta, "pdfFileName", `${baseName}.pdf`);

    return {
        htmlPath: join(htmlDir, htmlFileName),
        pdfPath: join(pdfDir, pdfFileName),
    };
}

function runBuild(absMarkdownPath, { htmlOnly }) {
    const scriptPath = resolve(__dirname, "..", "build.mjs");
    const args = [scriptPath, absMarkdownPath];
    if (htmlOnly) args.push("--html-only");

    try {
        execFileSync(process.execPath, args, {
            cwd: WORKSPACE,
            stdio: "pipe",
            encoding: "utf-8",
        });
    } catch (e) {
        const stderr = String(e?.stderr || "").trim();
        const stdout = String(e?.stdout || "").trim();
        throw new Error(stderr || stdout || e.message || "build実行に失敗しました");
    }
}

function rewritePreviewAssetSourcesFromBuiltHtml(html, absMarkdownPath) {
    return String(html || "")
        .replace(/(<img\b[^>]*\bsrc=)(["'])([^"']+)(\2)/gi, (m, head, q, src, tail) => {
            const nextSrc = resolvePreviewAssetUrl(src, absMarkdownPath);
            return `${head}${q}${nextSrc}${tail}`;
        })
        .replace(/(<source\b[^>]*\bsrc=)(["'])([^"']+)(\2)/gi, (m, head, q, src, tail) => {
            const nextSrc = resolvePreviewAssetUrl(src, absMarkdownPath);
            return `${head}${q}${nextSrc}${tail}`;
        });
}

function buildHeadingSourceLines(markdown) {
    const lines = String(markdown || "").split(/\r?\n/);
    const sourceLines = [];
    let inCodeFence = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^```/.test(line)) {
            inCodeFence = !inCodeFence;
            continue;
        }
        if (inCodeFence) continue;

        const m = line.match(/^(#{1,3})\s+(.+)/);
        if (!m) continue;
        sourceLines.push({
            index: sourceLines.length + 1,
            level: m[1].length,
            line: i + 1,
        });
    }
    return sourceLines;
}

function annotateBuiltHtmlWithSourceLines(html, markdown) {
    const headingSourceLines = buildHeadingSourceLines(markdown);
    if (!headingSourceLines.length) return String(html || "");

    const byIndex = new Map(headingSourceLines.map((h) => [h.index, h]));
    return String(html || "").replace(/<h([1-3])([^>]*)\sid="toc-(\d+)"([^>]*)>/gi, (m, level, before, idxRaw, after) => {
        const idx = Number(idxRaw);
        const src = byIndex.get(idx);
        if (!src) return m;

        const attrs = `${before || ""}${after || ""}`;
        if (/\sdata-source-line=/i.test(attrs)) {
            return m.replace(/\sdata-source-line="\d+"/i, ` data-source-line="${src.line}"`);
        }
        return `<h${level}${before || ""} id="toc-${idxRaw}" data-source-line="${src.line}" data-source-level="${src.level}"${after || ""}>`;
    });
}

function buildPreviewHtml(markdown, absPath) {
    const { meta, body } = parseFrontmatter(markdown);
    const effectivePageConfig = resolveEffectivePageConfig(meta, pageConfig);
    const effectiveStyleConfig = resolveEffectiveStyleConfig(meta, styleConfig);
    const paper = getPaperSizeMm(effectivePageConfig.paper);
    const isLandscape = effectivePageConfig.orientation === "landscape";
    const pageWidthMm = isLandscape ? paper.h : paper.w;
    const pageHeightMm = isLandscape ? paper.w : paper.h;
    const pageMargin = effectivePageConfig.margin || {};
    const mt = pageMargin.top || "20mm";
    const mr = pageMargin.right || "12mm";
    const mb = pageMargin.bottom || "18mm";
    const ml = pageMargin.left || "12mm";

    const previewCss = `
@media screen {
  html, body {
    background: #dfe6f1;
    padding: 0;
    margin: 0;
  }
  body {
    width: ${pageWidthMm}mm;
    min-height: ${pageHeightMm}mm;
    box-sizing: border-box;
    padding: ${mt} ${mr} ${mb} ${ml};
    background: #fff;
    margin: 20px auto;
    box-shadow: 0 12px 30px rgba(15, 23, 42, 0.2);
  }
  img {
    max-width: 100%;
    height: auto;
  }
    .page-break {
    border-top: 2px dashed #92a7c6;
    margin-top: 22px;
    padding-top: 22px;
    }
}
`;
    const cssContent = generateConfigCSS({ styleConfig: effectiveStyleConfig, dslConfig, pageCfg: effectivePageConfig }) + "\n" + structureCss + "\n" + previewCss;

    let resolvedBody = body;
    const warnings = [];
    try {
        const refResolved = resolveDslBodyWithWarnings(body, effectiveStyleConfig, dslConfig);
        resolvedBody = refResolved.markdown;
        warnings.push(...refResolved.warnings);
    } catch (e) {
        warnings.push(`参�E解決エラー: ${e.message}`);
    }

    const assetsBaseAbs = resolveAssetsBaseAbs(meta, WORKSPACE, dirname(absPath));
    meta.cover = resolveCoverPath(meta.cover, assetsBaseAbs);

    const paragraphIndentEnabled = isParagraphIndentEnabled(meta, effectivePageConfig);
    const bodyClass = paragraphIndentEnabled ? ' class="indent-body"' : "";
    const titlePageHtml = buildTitlePage(meta);

    const rawBodyHtml = transformDSL(resolvedBody, parseMd, { assetsBaseAbs });
    const bodyHtml = rewritePreviewImageSources(rawBodyHtml, absPath);
    const title = meta.title || basename(absPath, extname(absPath)) || "Preview";

    const fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>${cssContent}</style>
<script src="/mermaid.js"></script>
</head>
<body${bodyClass}>
${titlePageHtml}
${bodyHtml}
<script>
(function () {
    function convertMermaidCodeBlocks() {
        const codeBlocks = document.querySelectorAll("pre > code");
        codeBlocks.forEach((code) => {
            const className = String(code.className || "").toLowerCase();
            const dataLang = String(code.getAttribute("data-lang") || "").toLowerCase();
            const textHint = String(code.textContent || "").trimStart();
            const isMermaid =
                className.includes("mermaid") ||
                dataLang === "mermaid" ||
                textHint.startsWith("flowchart") ||
                textHint.startsWith("sequenceDiagram") ||
                textHint.startsWith("classDiagram") ||
                textHint.startsWith("stateDiagram") ||
                textHint.startsWith("erDiagram") ||
                textHint.startsWith("gantt") ||
                textHint.startsWith("pie") ||
                textHint.startsWith("journey") ||
                textHint.startsWith("mindmap") ||
                textHint.startsWith("timeline");
            if (!isMermaid) return;

            const pre = code.parentElement;
            if (!pre) return;
            const block = document.createElement("div");
            block.className = "mermaid";
            block.textContent = code.textContent || "";
            pre.replaceWith(block);
        });
    }

    async function renderMermaid() {
        if (!window.mermaid) return;
        window.mermaid.initialize({
            startOnLoad: false,
            theme: "neutral",
            flowchart: { htmlLabels: true },
            sequence: { useMaxWidth: false }
        });
        convertMermaidCodeBlocks();
        try {
            await window.mermaid.run({ querySelector: ".mermaid" });
        } catch {
            // preview should continue even when a mermaid block has syntax errors
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", renderMermaid);
    } else {
        renderMermaid();
    }
})();
</script>
</body>
</html>`;

    return { html: fullHtml, warnings };
}

async function buildPdfBinary(absMarkdownPath, markdownContent) {
    const { meta } = parseFrontmatter(markdownContent);
    const effectivePageConfig = resolveEffectivePageConfig(meta, pageConfig);
    const preview = buildPreviewHtml(markdownContent, absMarkdownPath);

    const { default: puppeteer } = await import("puppeteer");
    const chromePath = findSystemChrome();
    const browser = await puppeteer.launch({
        headless: true,
        ...(chromePath ? { executablePath: chromePath } : {}),
    });
    const page = await browser.newPage();
    await page.setContent(preview.html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
        format: effectivePageConfig.paper,
        landscape: effectivePageConfig.orientation === "landscape",
        margin: effectivePageConfig.margin,
        printBackground: true,
        ...buildHeaderFooterOptions(effectivePageConfig),
    });

    await browser.close();
    return {
        fileName: `${basename(absMarkdownPath, extname(absMarkdownPath))}.pdf`,
        bytes: Buffer.from(pdfBuffer),
    };
}

function sendJson(res, status, payload) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
    return new Promise((resolvePromise, rejectPromise) => {
        let raw = "";
        req.on("data", (chunk) => {
            raw += chunk;
            if (raw.length > 20 * 1024 * 1024) {
                rejectPromise(new Error("リクエストが大きすぎます"));
            }
        });
        req.on("end", () => {
            try {
                resolvePromise(raw ? JSON.parse(raw) : {});
            } catch {
                rejectPromise(new Error("JSONの解析に失敗しました"));
            }
        });
        req.on("error", rejectPromise);
    });
}

createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || `localhost:${PORT}`}`);

    if (req.method === "GET" && url.pathname === "/") {
        const html = readFileSync(GUI_HTML_PATH, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
    }

    if (req.method === "GET" && url.pathname === "/mermaid.js") {
        const js = readFileSync(MERMAID_JS, "utf-8");
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(js);
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/editor-highlight-theme") {
        try {
            const raw = readFileSync(EDITOR_HIGHLIGHT_THEME_PATH, "utf-8");
            const parsed = yaml.load(raw);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error("テーマ定義はオブジェクト形式で記述してください");
            }
            sendJson(res, 200, parsed);
        } catch (e) {
            sendJson(res, 500, { error: `テーマ読込に失敗しました: ${e.message}` });
        }
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/directories") {
        try {
            const directories = collectMarkdownDirectories(WORKSPACE).map((abs) => ({
                workspacePath: toWorkspaceRelative(abs),
            }));
            sendJson(res, 200, {
                currentBaseDir: toWorkspaceRelative(currentBaseDir),
                directories,
            });
        } catch (e) {
            sendJson(res, 500, { error: e.message });
        }
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/directories") {
        try {
            const body = await readJsonBody(req);
            const rel = String(body.baseDir || "").trim();
            const abs = absFromWorkspaceRelative(rel);
            if (!existsSync(abs) || !statSync(abs).isDirectory()) {
                sendJson(res, 400, { error: "チE��レクトリが存在しません" });
                return;
            }
            currentBaseDir = abs;
            sendJson(res, 200, {
                ok: true,
                baseDir: toWorkspaceRelative(currentBaseDir),
            });
        } catch (e) {
            sendJson(res, 400, { error: e.message });
        }
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/files") {
        try {
            const files = collectMarkdownFiles(currentBaseDir)
                .sort((a, b) => a.localeCompare(b, "ja"))
                .map((abs) => ({
                    workspacePath: toWorkspaceRelative(abs),
                    basePath: relative(currentBaseDir, abs).replace(/\\/g, "/"),
                }));
            sendJson(res, 200, {
                baseDir: toWorkspaceRelative(currentBaseDir),
                files,
            });
        } catch (e) {
            sendJson(res, 500, { error: e.message });
        }
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/file") {
        try {
            const relPath = url.searchParams.get("path") || "";
            const absPath = absFromWorkspaceRelative(relPath);
            if (!existsSync(absPath) || !statSync(absPath).isFile()) {
                sendJson(res, 404, { error: "ファイルが見つかりません" });
                return;
            }
            const content = readFileSync(absPath, "utf-8");
            sendJson(res, 200, {
                path: toWorkspaceRelative(absPath),
                content,
            });
        } catch (e) {
            sendJson(res, 400, { error: e.message });
        }
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/asset") {
        try {
            const relPath = String(url.searchParams.get("path") || "").trim();
            const absPath = absFromWorkspaceRelative(relPath);
            if (!existsSync(absPath) || !statSync(absPath).isFile()) {
                sendJson(res, 404, { error: "アセチE��が見つかりません" });
                return;
            }
            const bin = readFileSync(absPath);
            res.writeHead(200, {
                "Content-Type": getFileContentType(absPath),
                "Cache-Control": "no-cache",
            });
            res.end(bin);
        } catch (e) {
            sendJson(res, 400, { error: e.message });
        }
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/frontmatter/parse") {
        try {
            const body = await readJsonBody(req);
            const parsed = parseFrontmatter(String(body.content ?? ""));
            sendJson(res, 200, {
                meta: parsed.meta || {},
                body: parsed.body || "",
            });
        } catch (e) {
            sendJson(res, 400, { error: e.message });
        }
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/frontmatter/apply") {
        try {
            const body = await readJsonBody(req);
            const content = String(body.content ?? "");
            const meta = body.meta && typeof body.meta === "object" ? body.meta : {};
            const next = applyFrontmatter(content, meta);
            sendJson(res, 200, { content: next });
        } catch (e) {
            sendJson(res, 400, { error: e.message });
        }
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/preview") {
        try {
            const body = await readJsonBody(req);
            const relPath = String(body.path || "").trim();
            const content = String(body.content ?? "");
            const absPath = absFromWorkspaceRelative(relPath);

            // Keep preview identical to build.mjs output to preserve layout and heading sync.
            writeFileSync(absPath, content, "utf-8");
            runBuild(absPath, { htmlOnly: true });
            const { htmlPath } = resolveBuildOutputPaths(absPath, content);
            const builtHtml = readFileSync(htmlPath, "utf-8");
            const rewritten = rewritePreviewAssetSourcesFromBuiltHtml(builtHtml, absPath);
            const annotated = annotateBuiltHtmlWithSourceLines(rewritten, content);
            sendJson(res, 200, { html: annotated, warnings: [] });
        } catch (e) {
            sendJson(res, 400, { error: e.message });
        }
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/save") {
        try {
            const body = await readJsonBody(req);
            const relPath = String(body.path || "").trim();
            const content = String(body.content ?? "");
            const absPath = absFromWorkspaceRelative(relPath);
            writeFileSync(absPath, content, "utf-8");
            sendJson(res, 200, { ok: true, path: toWorkspaceRelative(absPath) });
        } catch (e) {
            sendJson(res, 400, { error: e.message });
        }
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/upload-image") {
        try {
            const body = await readJsonBody(req);
            const relPath = String(body.path || "").trim();
            const fileName = String(body.fileName || "image.png");
            const dataUrl = String(body.dataUrl || "");
            const absPath = absFromWorkspaceRelative(relPath);
            const markdownPath = saveUploadedImage(absPath, fileName, dataUrl);
            sendJson(res, 200, { ok: true, markdownPath });
        } catch (e) {
            sendJson(res, 400, { error: e.message });
        }
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/export-pdf") {
        try {
            const body = await readJsonBody(req);
            const relPath = String(body.path || "").trim();
            const content = String(body.content ?? "");
            const absPath = absFromWorkspaceRelative(relPath);

            writeFileSync(absPath, content, "utf-8");
            runBuild(absPath, { htmlOnly: false });
            const { pdfPath } = resolveBuildOutputPaths(absPath, content);
            const pdfBytes = readFileSync(pdfPath);
            sendJson(res, 200, {
                ok: true,
                fileName: basename(pdfPath),
                dataBase64: Buffer.from(pdfBytes).toString("base64"),
            });
        } catch (e) {
            sendJson(res, 400, { error: e.message });
        }
        return;
    }

    sendJson(res, 404, { error: "Not Found" });
}).listen(PORT, () => {
    console.log(`GUI server started: http://localhost:${PORT}`);
    console.log(`Base directory: ${currentBaseDir}`);
});

