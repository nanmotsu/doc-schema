/**
 * Markdown -> Word (.docx) ビルドスクリプト
 *
 * Usage:
 *   node build_word.mjs <input.md>
 *
 * Markdown が正。DSL ブロック・Mermaid ダイアグラムの PNG 埋め込みに対応。
 * コードブロックは等幅フォントで出力（シンタックスハイライトなし）。
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join, dirname, basename, extname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";
import * as http from "http";

import { marked } from "marked";
import { transformDSL } from "./dsl.mjs";
import { resolveDslReferences } from "./references.mjs";
import yaml from "js-yaml";
import HTMLtoDOCX from "html-to-docx";

const _require = createRequire(import.meta.url);
const MERMAID_JS = _require.resolve("mermaid/dist/mermaid.min.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(join(__dirname, "..", "..", ".."));
const CONVERT_SCHEMA = join(__dirname, "..", "..", "..", "000_schema", "convert");
const dslConfig = JSON.parse(readFileSync(join(CONVERT_SCHEMA, "dsl.json"), "utf-8"));
const styleConfig = JSON.parse(readFileSync(join(CONVERT_SCHEMA, "style.json"), "utf-8"));

// ── Chrome 検索 ────────────────────────────────────────────
function findSystemChrome() {
    const candidates = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ];
    return candidates.find(p => existsSync(p)) ?? null;
}
const CHROME_EXECUTABLE = findSystemChrome();

// ── フロントマターパーサー ───────────────────────────────────
function parseFrontmatter(markdown) {
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    if (!match) return { meta: {}, body: markdown };
    try {
        const meta = yaml.load(match[1]) || {};
        return { meta, body: markdown.slice(match[0].length) };
    } catch {
        return { meta: {}, body: markdown };
    }
}

// ── HTML エスケープ ─────────────────────────────────────────
function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function getOrderedHeadingLevels(headingCfg) {
    return (headingCfg?.levels || ["h1", "h2", "h3"])
        .map(l => parseInt(String(l).replace("h", ""), 10))
        .filter(n => n >= 1 && n <= 3)
        .sort((a, b) => a - b);
}

function applyHeadingNumbersToMarkdown(markdown, headingCfg) {
    const orderedLevels = getOrderedHeadingLevels(headingCfg);
    if (!headingCfg?.numbering || orderedLevels.length === 0) return markdown;

    const counters = {};
    for (const lv of orderedLevels) counters[lv] = 0;

    const lines = String(markdown ?? "").split(/\r?\n/);
    let inFence = false;

    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (/^```/.test(t)) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;

        const m = lines[i].match(/^(#{1,3})\s+(.+)$/);
        if (!m) continue;
        const level = m[1].length;
        if (!orderedLevels.includes(level)) continue;

        counters[level]++;
        for (const lv of orderedLevels) {
            if (lv > level) counters[lv] = 0;
        }

        const idx = orderedLevels.indexOf(level);
        const nums = orderedLevels.slice(0, idx + 1).map(lv => counters[lv]);
        const body = m[2].replace(/^\d+(?:\.\d+)*\.\s+/, "");
        lines[i] = `${m[1]} ${nums.join(".")}. ${body}`;
    }

    return lines.join("\n");
}

function applyCaptionNumbersToWordHtml(html, headingCfg, dslCfg) {
    const orderedLevels = getOrderedHeadingLevels(headingCfg);
    const numberingEnabled = !!headingCfg?.numbering && orderedLevels.length > 0;
    if (!numberingEnabled) return html;

    const topLevel = orderedLevels[0];
    const headingCounters = {};
    for (const lv of orderedLevels) headingCounters[lv] = 0;

    let figureCounter = 0;
    let tableCounter = 0;
    let lastHeadingText = "";

    const blockMap = new Map((dslCfg?.blocks || []).map(b => [b.name, b]));
    const figPrefix = blockMap.get("figure")?.captionPrefix || "図";
    const tblPrefix = blockMap.get("table")?.captionPrefix || "表";

    const tokenRe = /<h([1-3])([^>]*)>([\s\S]*?)<\/h\1>|(<figure\b[^>]*>[\s\S]*?<figcaption>)([\s\S]*?)(<\/figcaption>[\s\S]*?<\/figure>)|(<p class="table-caption">)([\s\S]*?)(<\/p>)|(<table\b[^>]*>[\s\S]*?<\/table>)/gi;
    let lastTableCaptionEnd = -1;

    return html.replace(tokenRe, (...args) => {
        const [all, hLv, hAttrs, hBody, figPre, figCap, figPost, tblPre, tblCap, tblPost, tableBlock, offsetRaw] = args;
        const offset = typeof offsetRaw === "number" ? offsetRaw : -1;
        if (hLv) {
            const level = parseInt(hLv, 10);
            if (!orderedLevels.includes(level)) return all;
            headingCounters[level]++;
            for (const lv of orderedLevels) {
                if (lv > level) headingCounters[lv] = 0;
            }
            const headingPlain = String(hBody ?? "")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .replace(/^\d+(?:\.\d+)*\.\s*/, "");
            if (headingPlain) {
                lastHeadingText = headingPlain;
            }
            if (level === topLevel) {
                figureCounter = 0;
                tableCounter = 0;
            }
            lastTableCaptionEnd = -1;
            return all;
        }

        if (figPre) {
            figureCounter++;
            const sectionNo = headingCounters[topLevel] || 0;
            const captionCore = String(figCap ?? "").trim().replace(/^(図|表)\s*\d+(?:\.\d+)?\s*/, "");
            lastTableCaptionEnd = -1;
            return `${figPre}${figPrefix}${sectionNo}.${figureCounter} ${captionCore}${figPost}`;
        }

        if (tblPre) {
            tableCounter++;
            const sectionNo = headingCounters[topLevel] || 0;
            const captionCore = String(tblCap ?? "").trim().replace(/^(図|表)\s*\d+(?:\.\d+)?\s*/, "");
            lastTableCaptionEnd = offset + all.length;
            return `${tblPre}${tblPrefix}${sectionNo}.${tableCounter} ${captionCore}${tblPost}`;
        }

        if (tableBlock) {
            const sectionNo = headingCounters[topLevel] || 0;
            const between = lastTableCaptionEnd >= 0 && offset >= 0
                ? html.slice(lastTableCaptionEnd, offset)
                : "";
            const pairedWithCaption = lastTableCaptionEnd >= 0 && /^\s*$/.test(between);
            lastTableCaptionEnd = -1;

            if (pairedWithCaption) return tableBlock;

            tableCounter++;
            const autoTitle = lastHeadingText || "表";
            return `<p class="table-caption">${tblPrefix}${sectionNo}.${tableCounter} ${autoTitle}</p>${tableBlock}`;
        }

        return all;
    });
}

// ── ローカル画像を data URI に変換（メモリ上で保持） ──────────────────
function resolveImagesToDataUri(html) {
    return html.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/gi, (_, pre, src, post) => {
        if (/^data:/i.test(src)) return pre + src + post;
        if (/^file:\/\//i.test(src)) {
            try {
                const filePath = fileURLToPath(src);
                const ext = extname(filePath).toLowerCase().slice(1);
                const mimeMap = {
                    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
                    gif: "image/gif", webp: "image/webp",
                };
                const mime = mimeMap[ext] || "image/png";
                const buf = readFileSync(filePath);
                return `${pre}data:${mime};base64,${buf.toString("base64")}${post}`;
            } catch {
                return pre + src + post;
            }
        }
        // 外部 http(s):// URL は透明 1x1 PNG に置換してダウンロードをスキップ
        // src="" にすると html-to-docx 側で data URI 解析時に例外になるため
        if (/^https?:\/\//i.test(src)) {
            const transparentPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBgN4A6xkAAAAASUVORK5CYII=";
            return `${pre}${transparentPng}${post}`;
        }
        return pre + src + post;
    });
}

// ── data URI 画像をローカル HTTP サーバーで配信（html-to-docx 用） ────
// html-to-docx は data: スキームを有効 URL として誤認識し、
// imageToBase64_min() がダウンロードに失敗するため、
// 一時 HTTP サーバーで画像を配信して安定的に処理させる。
async function serveImagesViaHttp(html) {
    const imageStore = new Map(); // id -> { mime, buffer }
    let imgIdx = 0;

    // data: URI を収集してプレースホルダーに置換（port はまだ未定）
    const placeholderHtml = html.replace(/src="data:([^;]+);base64,([^"]+)"/g, (_, mime, base64) => {
        const id = imgIdx++;
        const subtype = mime.split("/")[1] || "png";
        const ext = subtype === "jpeg" ? "jpg" : subtype;
        imageStore.set(id, { mime, ext, buffer: Buffer.from(base64, "base64") });
        return `src="__IMG_SERVER__/${id}.${ext}"`;
    });

    if (imgIdx === 0) {
        // 画像がなければサーバー不要
        return { html, cleanup: async () => { } };
    }

    const server = http.createServer((req, res) => {
        const m = req.url.match(/^\/([0-9]+)\.(\w+)$/);
        if (m) {
            const image = imageStore.get(parseInt(m[1]));
            if (image) {
                res.writeHead(200, { "Content-Type": image.mime, "Content-Length": image.buffer.length });
                res.end(image.buffer);
                return;
            }
        }
        res.writeHead(404);
        res.end();
    });

    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    const finalHtml = placeholderHtml.replace(/__IMG_SERVER__/g, `http://127.0.0.1:${port}`);
    const cleanup = () => new Promise(r => server.close(r));
    return { html: finalHtml, cleanup };
}

// ── CLI 引数 ────────────────────────────────────────────────
const args = process.argv.slice(2);
const inputArg = args.find(a => !a.startsWith("--"));

if (!inputArg) {
    console.error("Usage: node build_word.mjs <input.md>");
    process.exit(1);
}

const inputPath = resolve(inputArg);
if (!existsSync(inputPath)) {
    console.error(`ファイルが見つかりません: ${inputPath}`);
    process.exit(1);
}

const srcDir = dirname(inputPath);
const baseName = basename(inputPath, extname(inputPath));

function resolveOutputDir(meta, srcDir, preferredKey) {
    const preferred = meta?.[preferredKey];
    const shared = meta?.outputDir;
    const raw = preferred ?? shared;

    if (raw === undefined || raw === null) return srcDir;

    const text = String(raw).trim();
    if (!text) return srcDir;

    return resolve(srcDir, text);
}

function ensureExistingDirectory(pathValue, keyName) {
    if (!existsSync(pathValue)) {
        console.error(`出力ディレクトリが存在しません (${keyName}): ${pathValue}`);
        process.exit(1);
    }

    let isDir = false;
    try {
        isDir = statSync(pathValue).isDirectory();
    } catch {
        isDir = false;
    }

    if (!isDir) {
        console.error(`出力先がディレクトリではありません (${keyName}): ${pathValue}`);
        process.exit(1);
    }
}

function resolveOutputFileName(meta, key, fallback) {
    const raw = meta?.[key];
    if (raw === undefined || raw === null) return fallback;

    const text = String(raw).trim();
    return text || fallback;
}

// ── Markdown パーサー ──────────────────────────────────────
marked.setOptions({ gfm: true, breaks: false });
function parseMd(src) { return marked.parse(src); }

// ── 変換 ───────────────────────────────────────────────────
const rawMarkdown = readFileSync(inputPath, "utf-8");
const { meta, body } = parseFrontmatter(rawMarkdown);
let resolvedBody = body;

try {
    const refResolved = resolveDslReferences(body, {
        headingConfig: styleConfig.heading,
        dslBlocks: dslConfig.blocks,
    });
    resolvedBody = refResolved.markdown;
    if (refResolved.unknownRefs.length > 0) {
        console.warn(`⚠ 未解決の参照ID: ${refResolved.unknownRefs.join(", ")}`);
    }
} catch (e) {
    console.error(`参照解決エラー: ${e.message}`);
    process.exit(1);
}

const numberedBody = applyHeadingNumbersToMarkdown(resolvedBody, styleConfig.heading);

const docxDir = resolveOutputDir(meta, srcDir, "docxOutputDir");
const docxFileName = resolveOutputFileName(meta, "docxFileName", `${baseName}.docx`);
ensureExistingDirectory(docxDir, "docxOutputDir");
const docxPath = join(docxDir, docxFileName);

// Resolve asset base directory from frontmatter assetsBase.
const assetsBaseRaw = meta.assetsBase ?? null;
const assetsBaseAbs = assetsBaseRaw ? resolve(WORKSPACE_ROOT, assetsBaseRaw) : srcDir;
const assetsCtx = { assetsBaseAbs };

// ── DSL 変換 + Markdown -> HTML ───────────────────────────
let processedBodyHtml = transformDSL(numberedBody, parseMd, assetsCtx);

// ── Mermaid ブロックをプレースホルダーに置換 ───────────────────
const mermaidBlocks = [];
const mermaidBlockRegex = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g;
processedBodyHtml = processedBodyHtml.replace(mermaidBlockRegex, (_, code) => {
    const idx = mermaidBlocks.length;
    const decoded = code
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    mermaidBlocks.push({ idx, code: decoded });
    return `__MERMAID_${idx}__`;
});

// ── Mermaid -> PNG（Puppeteer でレンダリング） ────────────────
if (mermaidBlocks.length > 0) {
    console.log(`Mermaid ダイアグラム ${mermaidBlocks.length} 件を PNG に変換中...`);
    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({
        headless: true,
        ...(CHROME_EXECUTABLE ? { executablePath: CHROME_EXECUTABLE } : {}),
    });
    const page = await browser.newPage();

    const mermaidJs = readFileSync(MERMAID_JS, "utf-8");
    await page.setContent(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body { margin: 0; padding: 8px; background: white; }
* { font-family: 'Yu Gothic UI', 'Yu Gothic', 'Hiragino Sans', 'Noto Sans JP', sans-serif; }
</style></head><body></body></html>`);

    await page.evaluate(mermaidJs);
    await page.evaluate(() => {
        window.mermaid.initialize({
            startOnLoad: false,
            theme: "neutral",
            fontFamily: "'Yu Gothic UI', 'Yu Gothic', 'Hiragino Sans', 'Noto Sans JP', sans-serif",
            flowchart: { htmlLabels: true },
            sequence: { useMaxWidth: false },
        });
    });

    for (const block of mermaidBlocks) {
        const { idx, code } = block;
        try {
            const { svg } = await page.evaluate(async (c, i) => {
                return await window.mermaid.render(`mw${i}`, c);
            }, code, idx);

            // SVG を DOM に挿入してスクリーンショットを PNG 化
            await page.evaluate((svgStr) => {
                document.body.innerHTML = svgStr;
            }, svg);
            const svgEl = await page.$("svg");
            const pngData = await svgEl.screenshot({ type: "png", omitBackground: false });
            // Puppeteer 新バージョンは Uint8Array を返すため Buffer に変換してから base64 エンコード
            const pngBuffer = Buffer.isBuffer(pngData) ? pngData : Buffer.from(pngData);
            const base64 = pngBuffer.toString("base64");

            const imgTag = `<img src="data:image/png;base64,${base64}" alt="">`;

            processedBodyHtml = processedBodyHtml.replace(`__MERMAID_${idx}__`, imgTag);
        } catch (e) {
            console.warn(`⚠ Mermaid レンダリングエラー (ブロック ${idx}): ${e.message}`);
            processedBodyHtml = processedBodyHtml.replace(
                `__MERMAID_${idx}__`,
                `<p><em>[Mermaidエラー: ${escapeHtml(e.message)}]</em></p>`
            );
        }
    }

    await page.close();
    await browser.close();
}

// ── 通常画像の相対パスを file:/// 絶対パスに解決 ───────────────
processedBodyHtml = processedBodyHtml.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/gi, (_, pre, src, post) => {
    if (/^(https?:|file:|data:)/i.test(src)) return pre + src + post;
    const clean = src.replace(/^\.\//, "");
    return `${pre}${pathToFileURL(resolve(assetsBaseAbs, clean)).href}${post}`;
});

// Word では CSS カウンターが効かないため、キャプション番号を本文へ埋め込む。
processedBodyHtml = applyCaptionNumbersToWordHtml(processedBodyHtml, styleConfig.heading, dslConfig);

// ── file:/// 画像を data URI に変換（メモリ上） ────────────────
processedBodyHtml = resolveImagesToDataUri(processedBodyHtml);

// ── タイトル ──────────────────────────────────────────────
const title = meta.title || resolvedBody.match(/^#\s+(.+)/m)?.[1] || baseName;

// ── DOCX 用 HTML 組み立て ─────────────────────────────────
// html-to-docx はクラスベース CSS を完全にはサポートしないため、
// DSL ブロックのスタイルはインラインで補完する。
// コードブロックは <pre> の inline style で等幅フォントを維持する。
const docxHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
</head>
<body>
${processedBodyHtml
        // dsl.mjs の figure-body / mermaid-block ラッパーは Word では素の div に正規化
        .replace(/<div class="figure-body"([^>]*)>/g, '<div$1>')
        .replace(/<div class="mermaid-block"([^>]*)>/g, '<div$1>')
        // figure 全体を Word 互換ブロックに変換（本文 + キャプション）
        .replace(/<figure([^>]*)>([\s\S]*?)<\/figure>/gi, (_, figAttrs, inner) => {
            const alignMatch = String(figAttrs || "").match(/text-align\s*:\s*(left|center|right)/i);
            const align = alignMatch ? alignMatch[1].toLowerCase() : "center";

            const captionMatch = inner.match(/<figcaption>([\s\S]*?)<\/figcaption>/i);
            const caption = captionMatch ? captionMatch[1].trim() : "";
            const body = inner.replace(/<figcaption>[\s\S]*?<\/figcaption>/i, "").trim();

            const bodyBlock = body
                ? `<div style="text-align:${align};">${body}</div>`
                : "";
            const capBlock = caption
                ? `<p style="text-align:center;"><em>${caption}</em></p>`
                : "";
            return bodyBlock + capBlock;
        })
        // 画像 max-width:100%[;width:X][;height:Y] を width:X または 100% に変換
        .replace(/<img([^>]*?)style="max-width:100%(?:;([^"]*))?"([^>]*?)>/gi, (_, before, rest, after) => {
            const widthMatch = rest?.match(/width:([^;]+)/);
            const heightMatch = rest?.match(/height:([^;]+)/);
            const widthStyle = widthMatch ? `width:${widthMatch[1]}` : 'width:100%';
            const heightStyle = heightMatch ? `;height:${heightMatch[1]}` : '';
            return `<img${before}style="${widthStyle}${heightStyle}"${after}>`;
        })
        // コードブロック: 1行1<p>形式に変換（html-to-docx は <pre> 内改行を保持しないため）
        .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/g, (_, content) => {
            const monoStyle = "font-family:'Courier New','Consolas',monospace;font-size:9pt;margin:0;padding:2pt 0;";
            const lines = content.split('\n');
            while (lines.length && !lines[0].trim()) lines.shift();
            while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
            if (!lines.length) return '';
            return lines.map(l => `<p style="${monoStyle}">${l || '&#160;'}</p>`).join('\n');
        })
        // テーブル: <table> に border スタイルを強制付与
        .replace(/<table(?![^>]*border)[^>]*?>/gi, m => {
            if (m.includes('style=')) {
                return m.replace(/style="([^"]*)"/, (s, s1) => `style="${s1};border:0.6pt solid #999;border-collapse:collapse;margin-left:0;margin-right:auto;"`);
            } else {
                return m.replace(/<table/, '<table style="border:0.6pt solid #999;border-collapse:collapse;margin-left:0;margin-right:auto;"');
            }
        })
        // テーブルセル: 下 padding を除去し、全体を詰める
        .replace(/<(td|th)([^>]*)>/gi, (_, tag, attrs) => {
            if (/\bstyle="/i.test(attrs)) {
                return `<${tag}${attrs.replace(/\bstyle="([^"]*)"/i, (_m, s) => ` style="${s};padding-top:0;padding-bottom:0;border:0.6pt solid #999;"`)}>`;
            }
            return `<${tag}${attrs} style="padding-top:0;padding-bottom:0;border:0.6pt solid #999;">`;
        })
        // table-caption は左寄せ
        .replace(/<p class="table-caption">/g, '<p class="table-caption" style="text-align:left;margin:0 0 4pt 0;">')
        // DSL warning ブロック: 左ボーダー + 背景色
        .replace(/<div class="warning">/g, '<div style="color:#e67e00;background:#fff8f0;border-left:4px solid #e67e00;padding:6pt;">')
        // DSL center ブロック
        .replace(/<div class="center">/g, '<div style="text-align:center;">')
        // DSL right ブロック
        .replace(/<div class="right">/g, '<div style="text-align:right;">')
        // DSL large ブロック
        .replace(/<div class="large">/g, '<div style="font-size:18pt;">')
        // DSL red ブロック
        .replace(/<div class="red">/g, '<div style="color:#cc0000;">')
        // ページ区切り: page-break クラスの div を Word 改ページへ
        .replace(/<div class="page-break"><\/div>/g, '<div style="page-break-before:always;"></div>')
    }
</body>
</html>`;

// ── html-to-docx バグ対策: <thead>/<tbody>/<tfoot> が存在すると
// セクションの先頭行ごとに <w:tblGrid> が二重生成されて OOXML 違反になるため除去
// ただし <th>/<td> セルのスタイルは保持される
const docxHtmlFixed = docxHtml.replace(/<\/?(thead|tbody|tfoot)\b[^>]*>/gi, '');

// ── data URI 画像をローカル HTTP サーバー経由で html-to-docx に渡す ──
console.log("Word 変換中...");
const { html: docxHtmlForConvert, cleanup: stopImageServer } = await serveImagesViaHttp(docxHtmlFixed);
const docxBuffer = await HTMLtoDOCX(docxHtmlForConvert, null, {
    table: { row: { cantSplit: true } },
    footer: false,
    pageNumber: false,
    decodeUnicode: true,
    lang: { bidi: "ar-SA", eastAsia: "ja-JP", val: "ja-JP" },
    font: "Yu Gothic UI",
    fontSize: 22,     // 11pt（OOXML は half-points）
    margins: {
        top: 1134,    // 20mm
        right: 567,   // 10mm
        bottom: 850,  // 15mm
        left: 851,    // 15mm
        header: 0,
        footer: 0,
        gutter: 0,
    },
});

await stopImageServer();

// ── OOXML 修正: w:sectPr を w:body の最後に移動 ───────────────────────
const fixedDocxBuffer = await (async () => {
    const JSZip = _require("jszip");
    const zip = await JSZip.loadAsync(docxBuffer);
    const entry = zip.file("word/document.xml");
    if (!entry) return docxBuffer;

    let xml = await entry.async("string");

    // w:body 直下先頭にある w:sectPr を末尾の </w:body> 直前に移動
    const bodyOpenIdx = xml.indexOf("<w:body>");
    if (bodyOpenIdx === -1) return docxBuffer;

    const sectPrStartIdx = xml.indexOf("<w:sectPr>", bodyOpenIdx);
    if (sectPrStartIdx === -1) return docxBuffer;

    // sectPr が body の最初の子（間に空白のみ）であることを確認
    const betweenBodyAndSectPr = xml.slice(bodyOpenIdx + "<w:body>".length, sectPrStartIdx);
    if (betweenBodyAndSectPr.trim() !== "") return docxBuffer;

    const sectPrEndIdx = xml.indexOf("</w:sectPr>", sectPrStartIdx) + "</w:sectPr>".length;
    const sectPrText = xml.slice(sectPrStartIdx, sectPrEndIdx);

    // sectPr とその前後の空白を除去
    xml = xml.slice(0, bodyOpenIdx + "<w:body>".length) + xml.slice(sectPrEndIdx);

    // </w:body> 直前に挿入
    const bodyCloseIdx = xml.lastIndexOf("</w:body>");
    xml = xml.slice(0, bodyCloseIdx) + sectPrText + xml.slice(bodyCloseIdx);

    zip.file("word/document.xml", xml);
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
})();

writeFileSync(docxPath, fixedDocxBuffer);
console.log(`出力Word: ${docxPath}`);

