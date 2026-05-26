/**
 * Markdown → HTML / PDF ビルドスクリプト
 *
 * Usage:
 *   node build.mjs <input.md>              # HTML + PDF を生成
 *   node build.mjs <input.md> --html-only  # HTML のみ生成
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname, basename, extname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { marked } from "marked";
import { transformDSL } from "./dsl.mjs";
import { createRequire } from "module";
import yaml from "js-yaml";

const _require = createRequire(import.meta.url);
const MERMAID_JS = _require.resolve("mermaid/dist/mermaid.min.js");

const __dirname = dirname(fileURLToPath(import.meta.url));

// システムにインストール済みのChromeを優先して使用する。
// Puppeteer独自のChrome（要ダウンロード）より先に既存インストールを探す。
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
const WORKSPACE_ROOT = resolve(join(__dirname, "..", "..", ".."));
const CONVERT_SCHEMA = join(__dirname, "..", "..", "..", "000_schema", "convert");

// ── スキーマ読み込み ───────────────────────────────────────
const dslConfig = JSON.parse(readFileSync(join(CONVERT_SCHEMA, "dsl.json"), "utf-8"));
const styleConfig = JSON.parse(readFileSync(join(CONVERT_SCHEMA, "style.json"), "utf-8"));
const pageConfig = JSON.parse(readFileSync(join(CONVERT_SCHEMA, "page.json"), "utf-8"));

// ── CSS生成（スキーマ → CSS変数・カウンター・DSLクラス）────
function generateConfigCSS() {
    const { typography: t, colors: c, heading: h, spacing: s, dsl: d } = styleConfig;
    const { margin: m, paper, orientation } = pageConfig;

    // 見出し番号を付与するレベルを昇順に整理（動的生成の基準）
    const orderedLevels = (h.levels || ["h1", "h2", "h3"])
        .map(l => parseInt(l.replace("h", "")))
        .filter(n => n >= 1 && n <= 3)
        .sort((a, b) => a - b);

    // 図・表カウンター名リスト（h1 でリセット、body では初期化しない）
    const blockCounters = dslConfig.blocks.filter(b => b.counter).map(b => `${b.counter}-counter`);
    const tableDef = dslConfig.blocks.find(b => b.name === 'table');
    const tableBorderVal = tableDef?.showBorder === false ? 'none' : `1px solid ${tableDef?.border || '#bdc3c7'}`;

    // body に付与する counter-reset（最上位見出しのカウンターのみ）
    const counterNames = [];
    if (h.numbering && orderedLevels.length > 0) {
        counterNames.push(`h${orderedLevels[0]}-counter`);
    } else {
        // 見出し番号なしの場合は body でリセット
        counterNames.push(...blockCounters);
    }
    const counterReset = counterNames.length ? `counter-reset: ${counterNames.join(" ")};` : "";

    // 見出し自動番号 CSS（h.levels に含まれるレベルのみ、動的に生成）
    let headingCSS = "";
    if (h.numbering && orderedLevels.length > 0) {
        // 各レベルは次のレベルのカウンターをリセット
        // 最上位（h1）は図・表カウンターも同時にリセットしてセクション連番を実現
        for (let i = 0; i < orderedLevels.length - 1; i++) {
            const lv = orderedLevels[i];
            const resets = [`h${orderedLevels[i + 1]}-counter`];
            if (i === 0) resets.push(...blockCounters);
            headingCSS += `h${lv} { counter-reset: ${resets.join(" ")}; }\n`;
        }
        if (orderedLevels.length === 1 && blockCounters.length > 0) {
            headingCSS += `h${orderedLevels[0]} { counter-reset: ${blockCounters.join(" ")}; }\n`;
        }
        // ::before コンテンツ（このレベルまでのカウンターを連結）
        for (let i = 0; i < orderedLevels.length; i++) {
            const lv = orderedLevels[i];
            const parts = orderedLevels.slice(0, i + 1).map((cl, ci) =>
                ci === 0 ? `counter(h${cl}-counter)` : `"." counter(h${cl}-counter)`
            );
            const content = parts.length === 1
                ? `${parts[0]} ". "`
                : `${parts.join(" ")} ". "`;
            headingCSS += `h${lv}::before { counter-increment: h${lv}-counter; content: ${content}; }\n`;
        }
    }

    // DSLブロック CSS（dsl.json styles/captionStyles から生成）
    let blockCSS = "";
    for (const block of dslConfig.blocks) {
        if (block.styles) {
            const props = Object.entries(block.styles).map(([k, v]) => `    ${k}: ${v};`).join("\n");
            blockCSS += `.${block.class} {\n${props}\n}\n`;
        }
        if (block.captionStyles && block.captionPosition === "bottom") {
            const props = Object.entries(block.captionStyles).map(([k, v]) => `    ${k}: ${v};`).join("\n");
            blockCSS += `${block.element}.${block.class} figcaption {\n${props}\n}\n`;
        }
        if (block.captionStyles && block.captionPosition === "top") {
            const props = Object.entries(block.captionStyles).map(([k, v]) => `    ${k}: ${v};`).join("\n");
            blockCSS += `.${block.class} .table-caption {\n${props}\n}\n`;
        }
    }

    // 図・表カウンター CSS（見出し番号が有効な場合は「図h1番号.図番号」形式: 図3.2）
    const sectionCounterName = h.numbering && orderedLevels.length > 0
        ? `h${orderedLevels[0]}-counter`
        : null;
    let counterCSS = "";
    for (const block of dslConfig.blocks) {
        if (!block.counter) continue;
        const prefix = block.captionPrefix || "";
        const content = sectionCounterName
            ? `"${prefix}" counter(${sectionCounterName}) "." counter(${block.counter}-counter) " "`
            : `"${prefix}" counter(${block.counter}-counter) " "`;
        if (block.captionPosition === "bottom") {
            counterCSS += `${block.element}.${block.class} figcaption::before {\n    counter-increment: ${block.counter}-counter;\n    content: ${content};\n    font-weight: bold;\n}\n`;
        } else if (block.captionPosition === "top") {
            counterCSS += `.${block.class} .table-caption::before {\n    counter-increment: ${block.counter}-counter;\n    content: ${content};\n    font-weight: bold;\n}\n`;
        }
    }

    const tp = styleConfig.titlePage ?? {};

    // ページ高さ（用紙高さ - 上下マージン）を CSS 変数として出力
    const paperDimensions = {
        A4: { portrait: "297mm", landscape: "210mm" },
        A3: { portrait: "420mm", landscape: "297mm" },
        Letter: { portrait: "279mm", landscape: "216mm" },
        Legal: { portrait: "356mm", landscape: "216mm" },
    };
    const orient = orientation === "landscape" ? "landscape" : "portrait";
    const paperH = (paperDimensions[paper] ?? paperDimensions.A4)[orient];
    const contentH = `calc(${paperH} - ${m.top} - ${m.bottom})`;

    return [
        `/* === CSS変数 (style.json / page.json から生成) === */`,
        `:root {`,
        `    --h1-size:    ${t.fontSize.h1};`,
        `    --h2-size:    ${t.fontSize.h2};`,
        `    --h3-size:    ${t.fontSize.h3};`,
        `    --body-size:  ${t.fontSize.body};`,
        `    --small-size: ${t.fontSize.small || "13px"};`,
        `    --font-family: ${t.fontFamily};`,
        `    --body-line-height:    ${t.lineHeightBody ?? t.lineHeight ?? 1.8};`,
        `    --heading-line-height: ${t.lineHeightHeading ?? 1.3};`,
        `    --color-text:    ${c.text};`,
        `    --color-heading: ${c.heading};`,
        `    --color-heading-border: ${c.headingBorder};`,
        `    --color-subtle:  ${c.subtle};`,
        `    --color-link:    ${c.link};`,
        `    --color-code:    ${c.code};`,
        `    --color-code-bg: ${c.codeBg};`,
        `    --color-pre-bg:  ${c.preBg || "#f6f8fa"};`,
        `    --color-border:  ${tableDef?.border || "#bdc3c7"};`,
        `    --color-th-bg:   ${tableDef?.thBg || "#f0f0f0"};`,
        `    --table-cell-border: ${tableBorderVal};`,
        `    --table-cell-padding: ${tableDef?.cellPadding || "0.45em 0.8em"};`,
        `    --table-margin:       ${tableDef?.tableMargin || "1.5em 0"};`,
        `    --gap-paragraph:   ${s.paragraphGap};`,
        `    --gap-heading-top: ${s.headingTop};`,
        `    --gap-heading-bot: ${s.headingBottom};`,
        `    --toc-padding:      ${s.tocPadding ?? "2em 0"};`,
        `    --toc-item-padding: ${s.tocItemPadding ?? "0.3em 0"};`,
        `    --title-size:       ${tp.titleSize || "36px"};`,
        `    --subtitle-size:    ${tp.subtitleSize || "18px"};`,
        `    --cover-max-height: ${tp.coverMaxHeight || "360px"};`,
        `    --page-content-height: ${contentH};`,
        `}`,
        `@page {`,
        `    size: ${paper} ${orientation};`,
        `    margin: ${m.top} ${m.right} ${m.bottom} ${m.left};`,
        `}`,
        `body { ${counterReset} }`,
        `/* === 見出し番号 (style.json heading から生成) === */`,
        headingCSS,
        `/* === DSLブロック (dsl.json styles から生成) === */`,
        blockCSS,
        `/* === 図・表カウンター (dsl.json counter から生成) === */`,
        counterCSS,
    ].join("\n");
}

// ── フロントマターパーサー ────────────────────────────────────
/**
 * --- で囲まれた YAML フロントマターを解析し、メタ情報と本文を返す
 * key: value 形式のみ対応（ネスト不要）
 */
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

/** * page.json の headerFooter 設定から puppeteer page.pdf() に渡すオプションを生成する。
 * enabled: false のときは空オブジェクト（ヘッダー・フッターなし）を返す。
 * テンプレートは left / center / right の3列フレックスレイアウト。
 * 使用可能な特殊スパン:
 *   <span class='pageNumber'></span>  現在ページ番号
 *   <span class='totalPages'></span>  総ページ数
 *   <span class='date'></span>        出力日付
 *   <span class='title'></span>       ドキュメントタイトル
 */
function buildHeaderFooterOptions(cfg) {
    const hf = cfg.headerFooter ?? {};
    if (!hf.enabled) return {};

    const fontSize = hf.fontSize ?? "9px";
    const pl = cfg.margin?.left ?? "10mm";
    const pr = cfg.margin?.right ?? "10mm";

    const makeTemplate = (section) => {
        const { left = "", center = "", right = "" } = section ?? {};
        // puppeteer のヘッダー/フッターはデフォルト font-size が 0 になるため
        // <style> タグで全要素に明示的に適用する必要がある
        const styleTag = `<style>* { font-size: ${fontSize} !important; margin: 0; padding: 0; }</style>`;
        const body = [
            `<div style="width:100%;box-sizing:border-box;`,
            `display:flex;justify-content:space-between;align-items:center;`,
            `padding:0 ${pr} 0 ${pl};">`,
            `<span style="flex:1;text-align:left;">${left}</span>`,
            `<span style="flex:1;text-align:center;">${center}</span>`,
            `<span style="flex:1;text-align:right;">${right}</span>`,
            `</div>`,
        ].join("");
        return styleTag + body;
    };

    return {
        displayHeaderFooter: true,
        headerTemplate: makeTemplate(hf.header),
        footerTemplate: makeTemplate(hf.footer),
    };
}

/** * フロントマターのメタ情報から表題ページ HTML を生成する
 * title・subtitle・cover のいずれも省略可能
 */
function buildTitlePage(meta) {
    if (meta.titlePage === false) return "";
    if (!meta.title && !meta.cover) return "";
    const parts = ['<header class="title-page">'];
    if (meta.title) parts.push(`  <p class="doc-title">${meta.title}</p>`);
    if (meta.subtitle) parts.push(`  <p class="doc-subtitle">${meta.subtitle}</p>`);
    if (meta.cover) parts.push(`  <img class="cover-image" src="${meta.cover}" alt="">`);
    parts.push("</header>");
    return parts.join("\n");
}

/**
 * フロントマターの revisionHistory 配列から改訂履歴ページ HTML を生成する。
 * revisionHistory が面列または true のときのみ出力。
 */
function buildRevisionHistoryPage(meta) {
    // revisionHistoryPage: false で非表示（データを残したまま制御可能）
    if (meta.revisionHistoryPage === false) return "";
    if (!meta.revisionHistory || !Array.isArray(meta.revisionHistory)) return "";
    const rows = meta.revisionHistory;
    // 末尾の改行を除去してから \n → <br> に変換（YAMLの | ブロックスカラー対応）
    const cell = v => String(v ?? "").replace(/\n+$/, "").replace(/\n/g, "<br>");
    const rowsHtml = rows.map(r => [
        `        <tr>`,
        `            <td>${cell(r.version)}</td>`,
        `            <td>${cell(r.date)}</td>`,
        `            <td>${cell(r.author)}</td>`,
        `            <td>${cell(r.description)}</td>`,
        `        </tr>`,
    ].join("\n")).join("\n");
    return [
        '<section class="revision-history">',
        '  <p class="revision-history-title">改訂履歴</p>',
        '  <table>',
        '    <thead>',
        '      <tr>',
        '        <th class="col-version">版</th>',
        '        <th class="col-date">日付</th>',
        '        <th class="col-author">担当者</th>',
        '        <th class="col-description">改訂内容</th>',
        '      </tr>',
        '    </thead>',
        '    <tbody>',
        rowsHtml,
        '    </tbody>',
        '  </table>',
        '</section>',
    ].join("\n");
}

// ── 見出しスラグマップ構築 ────────────────────────────────────
/**
 * 本文 markdown から見出し（h1-h3）を抽出し、slug ID を付与して返す。
 * TOC 生成とカスタムレンダラーで同じ slug を共有するために使用。
 */
function buildSlugMap(markdown) {
    const slugCount = {};
    const headings = [];
    let inCodeBlock = false;
    for (const line of markdown.split(/\r?\n/)) {
        // コードフェンス（```）のトグル：内部の # を見出しとして拾わない
        if (/^```/.test(line)) { inCodeBlock = !inCodeBlock; continue; }
        if (inCodeBlock) continue;
        const m = line.match(/^(#{1,3})\s+(.+)/);
        if (!m) continue;
        const level = m[1].length;
        const rawText = m[2].trim();
        const textForSlug = rawText
            .replace(/`[^`]*`/g, "")
            .replace(/\*+|_+/g, "")
            .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
            .trim();
        const base = textForSlug
            .toLowerCase()
            .replace(/[\s\u3000]+/g, "-")
            .replace(/[^\w\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff\u3400-\u4dbf-]/g, "")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "") || "heading";
        const n = slugCount[base] ?? 0;
        slugCount[base] = n + 1;
        headings.push({ level, rawText, slug: n === 0 ? base : `${base}-${n}`, index: headings.length + 1 });
    }
    return headings;
}

/**
 * 見出しリストからリンク付き目次 HTML を生成する。
 * - 既定: 見出しから自動生成
 * - meta.tocManual がある場合: 手入力目次を優先
 * - meta.toc === false の場合: 目次を出力しない
 * - tocDepth: 目次に含める最大見出しレベル（1、3）
 *   優先順位: フロントマター > page.json > 3（デフォルト）
 */
function buildTOC(headings, meta, parseFn) {
    if (meta.toc === false) return "";

    const manualRaw = meta.tocManual ?? null;
    const hasManualTOC = (typeof manualRaw === "string" && manualRaw.trim() !== "")
        || (Array.isArray(manualRaw) && manualRaw.length > 0);
    if (hasManualTOC) {
        const manualMd = Array.isArray(manualRaw)
            ? manualRaw.map(v => String(v ?? "")).join("\n")
            : String(manualRaw);
        const manualHtml = parseFn(manualMd).trim();
        return [
            '<nav class="toc toc-manual">',
            '  <p class="toc-title">目次</p>',
            '  <div class="toc-manual-body">',
            manualHtml,
            '  </div>',
            '</nav>',
        ].join("\n");
    }

    // tocDepth: フロントマター > page.json > 3
    const rawDepth = meta.tocDepth ?? pageConfig.tocDepth ?? 3;
    const tocDepth = Math.max(1, Math.min(3, parseInt(rawDepth) || 3));

    const filteredHeadings = headings.filter(h => h.level <= tocDepth);
    if (filteredHeadings.length === 0) return "";

    // styleConfig.heading と同じレベル定義で番号を JS 側で再現
    const hs = styleConfig.heading;
    const orderedLevels = (hs.levels || ["h1", "h2", "h3"])
        .map(l => parseInt(l.replace("h", "")))
        .filter(n => n >= 1 && n <= 3)
        .sort((a, b) => a - b);
    const counters = {};
    orderedLevels.forEach(l => { counters[l] = 0; });

    const minLevel = Math.min(...filteredHeadings.map(h => h.level));
    const items = filteredHeadings.map(({ level, rawText, index }) => {
        // 番号生成（CSSカウンターと同じロジック）
        let prefix = "";
        if (hs.numbering && orderedLevels.includes(level)) {
            counters[level]++;
            orderedLevels.filter(l => l > level).forEach(l => { counters[l] = 0; });
            const levelIndex = orderedLevels.indexOf(level);
            const nums = orderedLevels.slice(0, levelIndex + 1).map(cl => counters[cl]);
            prefix = nums.length === 1 ? `${nums[0]}. ` : `${nums.join(".")}.\u0020`;
        }
        const display = rawText
            .replace(/`([^`]*)`/g, "$1")
            .replace(/\*\*([^*]*)\*\*/g, "$1")
            .replace(/\*([^*]*)\*/g, "$1")
            .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
        const indent = (level - minLevel) * 1.5;
        // href は数値 ID で固定（日本語アンカーの PDF 互換性問題を回避）
        return `    <li class="toc-level-${level}" style="padding-left:${indent}em"><a href="#toc-${index}">${prefix}${display}</a></li>`;
    });
    return [
        '<nav class="toc">',
        '  <p class="toc-title">目次</p>',
        '  <ul>',
        ...items,
        '  </ul>',
        '</nav>',
    ].join("\n");
}

// ── CLI 引数 ────────────────────────────────────────────────
const args = process.argv.slice(2);
const inputArg = args.find(a => !a.startsWith("--"));
const htmlOnly = args.includes("--html-only");

if (!inputArg) {
    console.error("Usage: node build.mjs <input.md> [--html-only]");
    process.exit(1);
}

const inputPath = resolve(inputArg);
if (!existsSync(inputPath)) {
    console.error(`ファイルが見つかりません: ${inputPath}`);
    process.exit(1);
}

const srcDir = dirname(inputPath);
const baseName = basename(inputPath, extname(inputPath));
const htmlPath = join(srcDir, `${baseName}.html`);
const pdfPath = join(srcDir, `${baseName}.pdf`);

// ── CSS ────────────────────────────────────────────────────
// スキーマから生成した変数・カウンター・DSLクラス CSS + 構造 CSS
const cssContent = generateConfigCSS() + "\n" + readFileSync(join(__dirname, "styles.css"), "utf-8");

// ── Markdown パーサー ──────────────────────────────────────
marked.setOptions({ gfm: true, breaks: false });
function parseMd(src) {
    return marked.parse(src);
}

/**
 * HTMLエスケープ済みコード文字列の先頭ディレクティブを解析する。
 * - %%fig: キャプション%%
 * - %%figure: キャプション%%
 * - %%caption: キャプション%%
 * ディレクティブがある場合のみ図番号付きキャプション化する。
 */
function parseCodeFigureDirective(escapedCode) {
    const m = escapedCode.match(/^%%\s*(?:fig|figure|caption):\s*(.*?)\s*%%\s*(?:\r?\n|$)/i);
    if (!m) return { caption: null, code: escapedCode };
    const caption = (m[1] ?? "").trim();
    const code = escapedCode.slice(m[0].length);
    return { caption: caption || null, code };
}

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Mermaidコード先頭のディレクティブを抽出する。
 * 対応:
 *   %%width: 70%%
 *   %%height: 180mm%%
 */
function parseMermaidDirectives(decodedCode) {
    const directives = { width: null, height: null };
    let code = decodedCode;

    while (true) {
        const m = code.match(/^%%\s*(width|height)\s*:\s*([^%\r\n]+)\s*%%\s*(?:\r?\n|$)/i);
        if (!m) break;
        directives[m[1].toLowerCase()] = m[2].trim();
        code = code.slice(m[0].length);
    }

    return { code, ...directives };
}

function appendInlineStyleToSvg(svg, styleChunk) {
    if (!styleChunk) return svg;
    if (!/^<svg\b/i.test(svg)) return svg;

    if (/^<svg\b[^>]*\sstyle="/i.test(svg)) {
        return svg.replace(/^<svg\b([^>]*?)\sstyle="([^"]*)"/i, (_m, before, style) =>
            `<svg${before} style="${style}; ${styleChunk}"`
        );
    }

    return svg.replace(/^<svg\b/i, `<svg style="${styleChunk}"`);
}

/**
 * 本文段落の先頭字下げ設定をフロントマターから判定する。
 * 優先順位: フロントマター > page.json。
 * paragraphIndent または bodyIndent を true/on/yes/1 にすると有効。
 */
function parseBoolLike(raw, fallback = false) {
    if (raw === undefined || raw === null) return fallback;
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    if (typeof raw === "string") {
        const val = raw.trim().toLowerCase();
        return ["1", "true", "on", "yes", "y"].includes(val);
    }
    return fallback;
}

function isParagraphIndentEnabled(meta, pageCfg) {
    const fmRaw = meta.paragraphIndent ?? meta.bodyIndent;
    if (fmRaw !== undefined) return parseBoolLike(fmRaw, false);

    const cfgRaw = pageCfg?.paragraphIndent ?? pageCfg?.bodyIndent;
    return parseBoolLike(cfgRaw, false);
}

// ── 変換 ───────────────────────────────────────────────────
const rawMarkdown = readFileSync(inputPath, "utf-8");
const { meta, body } = parseFrontmatter(rawMarkdown);

// アセットルート解決
// assetsInternal: フロントマターのみ（プロジェクトルートからの相対パス）
// assetsExternal: フロントマターのみ（外部 URL または絶対パス）
const internalRaw = meta.assetsInternal ?? null;
const internalAbs = internalRaw ? resolve(WORKSPACE_ROOT, internalRaw) : null;
const externalBase = meta.assetsExternal ?? null;
const assetsCtx = { internalAbs, externalBase };

// cover パスの解決（coverOrigin: internal | external に基づく）
// 相対パスのみ解決し、https: / file: / data: はそのまま使用
if (meta.cover && !/^(https?:|file:|data:)/i.test(meta.cover)) {
    const origin = meta.coverOrigin ?? 'internal';
    const clean = meta.cover.replace(/^\.\//, '');
    if (origin === 'external' && externalBase) {
        if (/^https?:/i.test(externalBase)) {
            meta.cover = externalBase.replace(/\/$/, '') + '/' + clean;
        } else {
            meta.cover = pathToFileURL(resolve(externalBase, clean)).href;
        }
    } else if (internalAbs) {
        meta.cover = pathToFileURL(resolve(internalAbs, clean)).href;
    }
}

// 見出しスラグマップを構築（TOC と見出し id に共有）
const headings = buildSlugMap(body);

// bodyHtml 生成後に <h1-3> タグへ id を付与（数値 ID で PDF との互換性を確保）
const rawBodyHtml = transformDSL(body, parseMd, assetsCtx);
let headingPostIndex = 0;
const bodyHtml = rawBodyHtml.replace(/<h([1-3])>/g, (_, lv) => {
    const h = headings[headingPostIndex++];
    return h ? `<h${lv} id="toc-${h.index}">` : `<h${lv}>`;
});


// Mermaid コードブロックを検出・収集しプレースホルダーに置換。
// ブロック先頭の %%width: 70%% / %%height: 180mm%% ディレクティブでサイズ指定可能。
const mermaidBlocks = [];
const mermaidBlockRegex = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>(?:\s*<p>([\s\S]*?)<\/p>)?/g;
let processedBodyHtml = bodyHtml.replace(mermaidBlockRegex, (_, code, caption) => {
    const idx = mermaidBlocks.length;
    const decoded = code
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    const { code: cleanCode, width, height } = parseMermaidDirectives(decoded);
    mermaidBlocks.push({ idx, code: cleanCode, caption: (caption || '').trim(), width, height });
    return `__MERMAID_${idx}__`;
});

// 通常コードブロックを任意で図化する。
// 先頭行に %%fig: キャプション%% を書いた場合のみ figure+figcaption に変換。
const codeBlockRegex = /<pre><code(?: class="([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g;
processedBodyHtml = processedBodyHtml.replace(codeBlockRegex, (_, klass, escapedCode) => {
    const classes = klass ? ` class="${klass}"` : "";
    const isMermaid = typeof klass === "string" && /(?:^|\s)language-mermaid(?:\s|$)/.test(klass);
    if (isMermaid) return `<pre><code${classes}>${escapedCode}</code></pre>`;

    const { caption, code } = parseCodeFigureDirective(escapedCode);
    if (!caption) return `<pre><code${classes}>${escapedCode}</code></pre>`;

    return [
        '<figure class="figure code-figure">',
        `<pre><code${classes}>${code}</code></pre>`,
        `<figcaption>${escapeHtml(caption)}</figcaption>`,
        '</figure>',
    ].join("");
});
const hasMermaid = mermaidBlocks.length > 0;

const titlePageHtml = buildTitlePage(meta);
const revisionHistoryHtml = buildRevisionHistoryPage(meta);
const tocHtml = buildTOC(headings, meta, parseMd);
const paragraphIndentEnabled = isParagraphIndentEnabled(meta, pageConfig);
const bodyClass = paragraphIndentEnabled ? ' class="indent-body"' : "";

// タイトル: フロントマター title → 本文の最初の h1 → ファイル名
const title = meta.title || body.match(/^#\s+(.+)/m)?.[1] || baseName;

// MermaidはSVG展開後の静的HTMLに埋め込むため、スクリプトは不要
// プレースホルダーを持つHTMLを先に生成し、後でSVGを埋め込む

// ── HTML 内容生成（Mermaidプレースホルダー入り）─────────────────
const htmlContent = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
${cssContent}
  </style>
</head>
<body${bodyClass}>
${titlePageHtml}
${revisionHistoryHtml}
${tocHtml}
${processedBodyHtml}
</body>
</html>`;

// Mermaid SVGをPuppeteerで生成してHTMLに静的埋め込み
let finalHtml = htmlContent;

if (hasMermaid) {
    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({
        headless: true,
        ...(CHROME_EXECUTABLE ? { executablePath: CHROME_EXECUTABLE } : {}),
    });
    const tmpPage = await browser.newPage();

    // ローカルmermaid.jsを注入してSVGを生成（CDN不要・オフライン完結）
    // htmlLabels:true → foreignObject+HTML で描画。<br>改行・複雑ネストの文字位置ずれを防止
    const mermaidJs = readFileSync(MERMAID_JS, "utf-8");
    await tmpPage.setContent(`<!DOCTYPE html><html><head><meta charset='UTF-8'><style>
* { font-family: 'Meiryo', 'Yu Gothic', 'MS PGothic', sans-serif; }
</style></head><body></body></html>`);
    await tmpPage.evaluate(mermaidJs);
    await tmpPage.evaluate(() => {
        window.mermaid.initialize({
            startOnLoad: false,
            theme: 'neutral',
            fontFamily: "'Meiryo', 'Yu Gothic', 'MS PGothic', sans-serif",
            flowchart: { htmlLabels: true },
            sequence: { useMaxWidth: false },
        });
    });

    const svgs = await tmpPage.evaluate(async (blocks) => {
        const out = [];
        for (const { idx, code } of blocks) {
            try {
                const { svg } = await window.mermaid.render(`m${idx}`, code);
                out.push(svg);
            } catch (e) {
                out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="40"><text fill="red" y="20">Mermaidエラー: ${e.message}</text></svg>`);
            }
        }
        return out;
    }, mermaidBlocks);

    await tmpPage.close();
    await browser.close();

    // foreignObject の表示を修正する。
    // 問題①: Mermaid は nodeLabel の内容を <span><p>...</p></span> の形で生成するが、
    //         ブロック要素 <p> をインライン要素 <span> の中に入れると HTML パーサーの
    //         adoption algorithm により DOM が再構築され、テキストが重なる。
    //         <p> を除去して <br> だけ残せば <span> 内でインライン改行が正しく機能する。
    // 問題②: Mermaid は div に display:table-cell を設定するが、親に display:table が
    //         存在しないため table-cell が block 扱いになり縦中央揃えが効かない。
    //         <p> 除去後は <span> がフレックスアイテムとして機能できるため flex で置換する。
    //         (<p> がない状態では <span> 内の <br> はフレックスコンテナの外で作用するので
    //          <br> による改行は正しく機能する)
    const fixedSvgs = svgs.map(svg =>
        svg
            // ① <p> ラッパー除去（<polygon> など他の SVG 要素と区別するため \b を使用）
            .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/g, '$1')
            // ② display:table-cell → flex に置換（縦横中央揃え）
            .replace(
                /style="display: table-cell;([^"]*)"/g,
                'style="display: flex; align-items: center; justify-content: center; height: 100%;$1"'
            )
    );

    // 取得したSVGをfigureにラップしてプレースホルダーを置換
    for (let i = 0; i < mermaidBlocks.length; i++) {
        const { caption, width, height } = mermaidBlocks[i];
        const figcaption = caption ? `<figcaption>${caption}</figcaption>` : '';
        const widthStyle = width ? ` style="width:${width};margin:0 auto;"` : '';
        const svgWithHeight = height
            ? appendInlineStyleToSvg(fixedSvgs[i], `max-height:${height};height:auto;max-width:100%;display:block;margin:0 auto;`)
            : fixedSvgs[i];
        finalHtml = finalHtml.replace(`__MERMAID_${i}__`, `<figure class="figure"${widthStyle}>${svgWithHeight}${figcaption}</figure>`);
    }
}

// origin を持たない img（通常マークダウン画像・ origin 未指定 figure）の相対 src を
// internalAbs 起点の絶対 file:/// パスに書き換える。
if (internalAbs) {
    const absNorm = internalAbs.replace(/\\/g, "/");
    finalHtml = finalHtml.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/gi, (_, pre, src, post) => {
        if (/^(https?:|file:|data:)/i.test(src)) return pre + src + post;
        const clean = src.replace(/^\.\//, "");
        return `${pre}${pathToFileURL(resolve(absNorm, clean)).href}${post}`;
    });
}
writeFileSync(htmlPath, finalHtml, "utf-8");
console.log(`✓ HTML: ${htmlPath}`);

if (htmlOnly) process.exit(0);

// ── PDF 出力 ───────────────────────────────────────────────
console.log("PDF 生成中...");
const { default: puppeteer } = await import("puppeteer");

const browser = await puppeteer.launch({
    headless: true,
    ...(CHROME_EXECUTABLE ? { executablePath: CHROME_EXECUTABLE } : {}),
});
const page = await browser.newPage();

await page.goto(pathToFileURL(htmlPath).href, {
    waitUntil: "networkidle0",
});

await page.pdf({
    path: pdfPath,
    format: pageConfig.paper,
    landscape: pageConfig.orientation === "landscape",
    margin: pageConfig.margin,
    printBackground: true,
    ...buildHeaderFooterOptions(pageConfig),
});

await browser.close();
console.log(`✓ PDF:  ${pdfPath}`);
