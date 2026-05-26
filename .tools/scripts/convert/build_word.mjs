/**
 * Markdown → Word (.docx) ビルドスクリプト
 *
 * Usage:
 *   node build_word.mjs <input.md>
 *
 * マークダウンが正。DSLブロック・Mermaidダイアグラム（PNG埋め込み）対応。
 * コードブロックは等幅フォントで出力（シンタックスハイライトなし）。
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname, basename, extname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";
import * as http from "http";

import { marked } from "marked";
import { transformDSL } from "./dsl.mjs";
import yaml from "js-yaml";
import HTMLtoDOCX from "html-to-docx";

const _require = createRequire(import.meta.url);
const MERMAID_JS = _require.resolve("mermaid/dist/mermaid.min.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(join(__dirname, "..", "..", ".."));

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

// ── フロントマターパーサー ────────────────────────────────────
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

// ── Mermaidディレクティブ抽出 ─────────────────────────────────
function parseMermaidDirectives(decodedCode) {
    const directives = { width: null, height: null };
    let code = decodedCode;
    while (true) {
        const m = code.match(/^%%\s*(width|height)\s*:\s*([\d.]+%?)%*\s*(?:\r?\n|$)/i);
        if (!m) break;
        directives[m[1].toLowerCase()] = m[2].trim();
        code = code.slice(m[0].length);
    }
    return { code, ...directives };
}

// ── HTML エスケープ ──────────────────────────────────────────
function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// ── コード図ディレクティブ解析 ───────────────────────────────
function parseCodeFigureDirective(escapedCode) {
    const m = escapedCode.match(/^%%\s*(?:fig|figure|caption):\s*(.*?)\s*%%\s*(?:\r?\n|$)/i);
    if (!m) return { caption: null, code: escapedCode };
    const caption = (m[1] ?? "").trim();
    const code = escapedCode.slice(m[0].length);
    return { caption: caption || null, code };
}

// ── ローカル画像を data URI に変換（メモリ内で保持）─────────────────────
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

// ── data URI 画像をローカル HTTP サーバーで配信（html-to-docx 用）──────
// html-to-docx は data: スキームを有効URLとして誤認識し、
// imageToBase64_min() がダウンロードに失敗するため、
// 一時HTTPサーバーで画像を配信して安全に処理させる。
async function serveImagesViaHttp(html) {
    const imageStore = new Map(); // id -> { mime, buffer }
    let imgIdx = 0;

    // data: URI を収集してプレースホルダーに置換（portはまだ未定）
    const placeholderHtml = html.replace(/src="data:([^;]+);base64,([^"]+)"/g, (_, mime, base64) => {
        const id = imgIdx++;
        const subtype = mime.split("/")[1] || "png";
        const ext = subtype === "jpeg" ? "jpg" : subtype;
        imageStore.set(id, { mime, ext, buffer: Buffer.from(base64, "base64") });
        return `src="__IMG_SERVER__/${id}.${ext}"`;
    });

    if (imgIdx === 0) {
        // 画像なし → サーバー不要
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
const docxPath = join(srcDir, `${baseName}.docx`);

// ── Markdown パーサー ──────────────────────────────────────
marked.setOptions({ gfm: true, breaks: false });
function parseMd(src) { return marked.parse(src); }

// ── 変換 ───────────────────────────────────────────────────
const rawMarkdown = readFileSync(inputPath, "utf-8");
const { meta, body } = parseFrontmatter(rawMarkdown);

// アセットルート解決（フロントマターの assetsInternal を起点に相対パスを解決）
const internalRaw = meta.assetsInternal ?? null;
const internalAbs = internalRaw ? resolve(WORKSPACE_ROOT, internalRaw) : null;
const externalBase = meta.assetsExternal ?? null;
const assetsCtx = { internalAbs, externalBase };

// ── DSL 変換 + Markdown → HTML ────────────────────────────
let processedBodyHtml = transformDSL(body, parseMd, assetsCtx);

// ── Mermaid ブロックをプレースホルダーに置換 ──────────────────
const mermaidBlocks = [];
const mermaidBlockRegex = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>(?:\s*<p>([\s\S]*?)<\/p>)?/g;
processedBodyHtml = processedBodyHtml.replace(mermaidBlockRegex, (_, code, caption) => {
    const idx = mermaidBlocks.length;
    const decoded = code
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    const { code: cleanCode, width } = parseMermaidDirectives(decoded);
    mermaidBlocks.push({ idx, code: cleanCode, caption: (caption || "").trim(), width });
    return `__MERMAID_${idx}__`;
});

// ── コードブロックの図化（%%fig: キャプション%% ディレクティブ対応）─
const codeBlockRegex = /<pre><code(?: class="([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g;
processedBodyHtml = processedBodyHtml.replace(codeBlockRegex, (_, klass, escapedCode) => {
    const classes = klass ? ` class="${klass}"` : "";
    const isMermaid = typeof klass === "string" && /(?:^|\s)language-mermaid(?:\s|$)/.test(klass);
    if (isMermaid) return `<pre><code${classes}>${escapedCode}</code></pre>`;

    const { caption, code } = parseCodeFigureDirective(escapedCode);
    if (!caption) return `<pre><code${classes}>${escapedCode}</code></pre>`;

    return [
        `<p style="text-align:center;font-weight:bold;">${escapeHtml(caption)}</p>`,
        `<pre><code${classes}>${code}</code></pre>`,
    ].join("");
});

// ── Mermaid → PNG（Puppeteer でレンダリング）────────────────
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
* { font-family: 'Meiryo', 'Yu Gothic', 'MS PGothic', sans-serif; }
</style></head><body></body></html>`);

    await page.evaluate(mermaidJs);
    await page.evaluate(() => {
        window.mermaid.initialize({
            startOnLoad: false,
            theme: "neutral",
            fontFamily: "'Meiryo', 'Yu Gothic', 'MS PGothic', sans-serif",
            flowchart: { htmlLabels: true },
            sequence: { useMaxWidth: false },
        });
    });

    for (const block of mermaidBlocks) {
        const { idx, code, caption, width } = block;
        try {
            const { svg } = await page.evaluate(async (c, i) => {
                return await window.mermaid.render(`mw${i}`, c);
            }, code, idx);

            // SVG を DOM に挿入してスクリーンショット（PNG）
            await page.evaluate((svgStr) => {
                document.body.innerHTML = svgStr;
            }, svg);
            const svgEl = await page.$("svg");
            const pngData = await svgEl.screenshot({ type: "png", omitBackground: false });
            // Puppeteer 新バージョンは Uint8Array を返すため Buffer に変換してから base64 エンコード
            const pngBuffer = Buffer.isBuffer(pngData) ? pngData : Buffer.from(pngData);
            const base64 = pngBuffer.toString("base64");

            // html-to-docx は CSS style.width を参照するため style 属性を使用
            // HTML width="X%" は vNode.properties.attributes に入り無視される
            const widthStyle = width ? `style="width:${width}"` : '';
            const imgTag = caption
                ? `<figure><img src="data:image/png;base64,${base64}" ${widthStyle} alt="${escapeHtml(caption)}"><figcaption>${caption}</figcaption></figure>`
                : `<figure><img src="data:image/png;base64,${base64}" ${widthStyle} alt=""></figure>`;

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

// ── 通常画像の相対パス → file:/// 絶対パスに解決 ──────────────
if (internalAbs) {
    processedBodyHtml = processedBodyHtml.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/gi, (_, pre, src, post) => {
        if (/^(https?:|file:|data:)/i.test(src)) return pre + src + post;
        const clean = src.replace(/^\.\//, "");
        return `${pre}${pathToFileURL(resolve(internalAbs, clean)).href}${post}`;
    });
}

// ── file:/// 画像を data URI に変換（メモリ内）─
processedBodyHtml = resolveImagesToDataUri(processedBodyHtml);

// ── タイトル ──────────────────────────────────────────────
const title = meta.title || body.match(/^#\s+(.+)/m)?.[1] || baseName;

// ── DOCX 用 HTML 組み立て ─────────────────────────────────
// html-to-docx はクラスベース CSS を完全にはサポートしないため、
// DSLブロックのスタイルはインラインで補完する。
// コードブロックは <pre> の inline style で等幅フォントを指定。
const docxHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
</head>
<body>
${processedBodyHtml
        // figure: <figure><img...> または <figure><p><img...></p> を Word 互換段落に変換
        .replace(/<figure[^>]*>\s*(?:<p>\s*)?<img([^>]*)>(?:\s*<\/p>)?\s*(<figcaption>([\s\S]*?)<\/figcaption>)?\s*<\/figure>/gi, (_, imgAttrs, _fc, caption) => {
            const imgTag = `<img${imgAttrs}>`;
            const imgP = `<p style="text-align:center;">${imgTag}</p>`;
            const capP = caption ? `<p style="text-align:center;"><em>${caption.trim()}</em></p>` : '';
            return imgP + capP;
        })
        // 画像: max-width:100%[;width:X][;height:Y] → width:X（または100%）に変換
        .replace(/<img([^>]*?)style="max-width:100%(?:;([^"]*))?"([^>]*?)>/gi, (_, before, rest, after) => {
            const widthMatch = rest?.match(/width:([^;]+)/);
            const heightMatch = rest?.match(/height:([^;]+)/);
            const widthStyle = widthMatch ? `width:${widthMatch[1]}` : 'width:100%';
            const heightStyle = heightMatch ? `;height:${heightMatch[1]}` : '';
            return `<img${before}style="${widthStyle}${heightStyle}"${after}>`;
        })
        // コードブロック: 1行1<p>形式に変換（html-to-docx は <pre> 内の改行を保持しないため）
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
                return m.replace(/style="([^"]*)"/, (s, s1) => `style="${s1};border:1px solid #000;border-collapse:collapse;"`);
            } else {
                return m.replace(/<table/, '<table style="border:1px solid #000;border-collapse:collapse;"');
            }
        })
        // DSL warningブロック: 左ボーダー+背景色
        .replace(/<div class="warning">/g, '<div style="color:#e67e00;background:#fff8f0;border-left:4px solid #e67e00;padding:6pt;">')
        // DSL centerブロック
        .replace(/<div class="center">/g, '<div style="text-align:center;">')
        // DSL rightブロック
        .replace(/<div class="right">/g, '<div style="text-align:right;">')
        // DSL largeブロック
        .replace(/<div class="large">/g, '<div style="font-size:18pt;">')
        // DSL redブロック
        .replace(/<div class="red">/g, '<div style="color:#cc0000;">')
        // ページ区切り（page-breakクラスのdiv → Word改ページ）
        .replace(/<div class="page-break"><\/div>/g, '<div style="page-break-before:always;"></div>')
    }
</body>
</html>`;

// ── html-to-docx バグ対策: <thead>/<tbody>/<tfoot> が存在すると
// 各セクションの先頭行ごとに <w:tblGrid> が二重生成されて OOXML 違反になるため除去
// （<th>/<td> セルのスタイルは保持される）
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
    font: "Meiryo",
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

// ── OOXML 修正: w:sectPr を w:body の最後に移動 ─────────────────────────
const fixedDocxBuffer = await (async () => {
    const JSZip = _require("jszip");
    const zip = await JSZip.loadAsync(docxBuffer);
    const entry = zip.file("word/document.xml");
    if (!entry) return docxBuffer;

    let xml = await entry.async("string");

    // w:body 直下の先頭にある w:sectPr を末尾の </w:body> 直前に移動
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
console.log(`✓ Word: ${docxPath}`);
