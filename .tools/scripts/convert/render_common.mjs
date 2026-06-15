import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import yaml from "js-yaml";
import { resolveDslReferences } from "./references.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONVERT_SCHEMA = join(__dirname, "..", "..", "..", "000_schema", "convert");
const STYLE_SHEET_PATH = join(__dirname, "styles.css");

export function loadConvertConfig() {
    return {
        dslConfig: JSON.parse(readFileSync(join(CONVERT_SCHEMA, "dsl.json"), "utf-8")),
        styleConfig: JSON.parse(readFileSync(join(CONVERT_SCHEMA, "style.json"), "utf-8")),
        pageConfig: JSON.parse(readFileSync(join(CONVERT_SCHEMA, "page.json"), "utf-8")),
        structureCss: readFileSync(STYLE_SHEET_PATH, "utf-8"),
    };
}

export function parseFrontmatter(markdown) {
    // Strip UTF-8 BOM if present (added by some editors/PowerShell Set-Content)
    const src = String(markdown ?? "").replace(/^\uFEFF/, "");
    const match = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    if (!match) return { meta: {}, body: src };
    try {
        const meta = yaml.load(match[1]) || {};
        return { meta, body: src.slice(match[0].length) };
    } catch {
        return { meta: {}, body: src };
    }
}

export function parseBoolLike(raw, fallback = false) {
    if (raw === undefined || raw === null) return fallback;
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    if (typeof raw === "string") {
        const val = raw.trim().toLowerCase();
        return ["1", "true", "on", "yes", "y"].includes(val);
    }
    return fallback;
}

export function isParagraphIndentEnabled(meta, pageCfg) {
    const fmRaw = meta?.paragraphIndent;
    if (fmRaw !== undefined) return parseBoolLike(fmRaw, false);

    const cfgRaw = pageCfg?.paragraphIndent;
    return parseBoolLike(cfgRaw, false);
}

export function resolveEffectivePageConfig(meta, basePageConfig) {
    const normalizedMargin = {
        top: meta?.margin?.top ?? basePageConfig.margin?.top,
        right: meta?.margin?.right ?? basePageConfig.margin?.right,
        bottom: meta?.margin?.bottom ?? basePageConfig.margin?.bottom,
        left: meta?.margin?.left ?? basePageConfig.margin?.left,
    };

    const orientationRaw = String(meta?.orientation ?? basePageConfig.orientation ?? "portrait").toLowerCase();
    const orientation = orientationRaw === "landscape" ? "landscape" : "portrait";

    return {
        ...basePageConfig,
        paper: meta?.paper ?? basePageConfig.paper,
        orientation,
        margin: normalizedMargin,
        tocDepth: meta?.tocDepth ?? basePageConfig.tocDepth,
        paragraphIndent: meta?.paragraphIndent ?? basePageConfig.paragraphIndent,
        headerFooter: meta?.headerFooter ?? basePageConfig.headerFooter ?? { enabled: false },
    };
}

export function resolveEffectiveStyleConfig(meta, baseStyleConfig) {
    const style = baseStyleConfig || {};
    const headingBase = style.heading || {};
    const baseHeadingNumbering = parseBoolLike(headingBase.numbering, true);

    // フロントマターで見出し番号の ON/OFF を上書き可能にする。
    // 優先順: headingNumbering > heading.numbering > style.json
    let headingNumbering = baseHeadingNumbering;
    if (meta?.headingNumbering !== undefined) {
        headingNumbering = parseBoolLike(meta.headingNumbering, baseHeadingNumbering);
    } else if (meta?.heading?.numbering !== undefined) {
        headingNumbering = parseBoolLike(meta.heading.numbering, baseHeadingNumbering);
    }

    return {
        ...style,
        heading: {
            ...headingBase,
            numbering: headingNumbering,
        },
    };
}

export function resolveDslBodyWithWarnings(body, styleConfig, dslConfig) {
    const refResolved = resolveDslReferences(body, {
        headingConfig: styleConfig.heading,
        dslBlocks: dslConfig.blocks,
    });

    return {
        markdown: refResolved.markdown,
        warnings: refResolved.unknownRefs.length > 0
            ? [`未解決参�E: ${refResolved.unknownRefs.join(", ")}`]
            : [],
    };
}

export function resolveAssetsBaseAbs(meta, workspaceRoot, srcDir) {
    const assetsBaseRaw = meta?.assetsBase ?? null;
    return assetsBaseRaw ? resolve(workspaceRoot, String(assetsBaseRaw)) : srcDir;
}

export function resolveCoverPath(cover, assetsBaseAbs) {
    if (!cover) return cover;
    const text = String(cover);
    if (/^(https?:|file:|data:)/i.test(text)) return text;
    const clean = text.replace(/^\.\//, "");
    return pathToFileURL(resolve(assetsBaseAbs, clean)).href;
}

export function buildTitlePage(meta) {
    if (meta?.titlePage === false) return "";
    if (!meta?.title && !meta?.cover) return "";
    const parts = ['<header class="title-page">'];
    if (meta?.title) parts.push(`  <p class="doc-title">${meta.title}</p>`);
    if (meta?.subtitle) parts.push(`  <p class="doc-subtitle">${meta.subtitle}</p>`);
    if (meta?.cover) parts.push(`  <img class="cover-image" src="${meta.cover}" alt="">`);
    parts.push("</header>");
    return parts.join("\n");
}

export function buildHeaderFooterOptions(cfg) {
    const hf = cfg?.headerFooter ?? {};
    if (!hf.enabled) return {};

    const fontSize = hf.fontSize ?? "9px";
    const pl = cfg?.margin?.left ?? "10mm";
    const pr = cfg?.margin?.right ?? "10mm";

    const makeTemplate = (section) => {
        const { left = "", center = "", right = "" } = section ?? {};
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

export function generateConfigCSS({ styleConfig, dslConfig, pageCfg }) {
    const { typography: t, colors: c, heading: h, spacing: s } = styleConfig;
    const { margin: m, paper, orientation } = pageCfg;

    const orderedLevels = (h.levels || ["h1", "h2", "h3"])
        .map((l) => parseInt(l.replace("h", ""), 10))
        .filter((n) => n >= 1 && n <= 3)
        .sort((a, b) => a - b);

    const blockCounters = dslConfig.blocks.filter((b) => b.counter).map((b) => `${b.counter}-counter`);
    const tableDef = dslConfig.blocks.find((b) => b.name === "table");
    const tableBorderVal = tableDef?.showBorder === false ? "none" : `1px solid ${tableDef?.border || "#bdc3c7"}`;

    const counterNames = [];
    if (h.numbering && orderedLevels.length > 0) {
        counterNames.push(`h${orderedLevels[0]}-counter`);
        counterNames.push(...blockCounters);
    } else {
        counterNames.push(...blockCounters);
    }
    const counterReset = counterNames.length ? `counter-reset: ${counterNames.join(" ")};` : "";

    let headingCSS = "";
    if (h.numbering && orderedLevels.length > 0) {
        for (let i = 0; i < orderedLevels.length - 1; i++) {
            const lv = orderedLevels[i];
            const resets = [`h${orderedLevels[i + 1]}-counter`];
            if (i === 0) resets.push(...blockCounters);
            headingCSS += `h${lv} { counter-reset: ${resets.join(" ")}; }\n`;
        }
        if (orderedLevels.length === 1 && blockCounters.length > 0) {
            headingCSS += `h${orderedLevels[0]} { counter-reset: ${blockCounters.join(" ")}; }\n`;
        }
        for (let i = 0; i < orderedLevels.length; i++) {
            const lv = orderedLevels[i];
            const parts = orderedLevels.slice(0, i + 1).map((cl, ci) =>
                ci === 0 ? `counter(h${cl}-counter)` : `"." counter(h${cl}-counter)`
            );
            const content = parts.length === 1 ? `${parts[0]} ". "` : `${parts.join(" ")} ". "`;
            headingCSS += `h${lv}::before { counter-increment: h${lv}-counter; content: ${content}; }\n`;
        }
    }

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

    const sectionCounterName = h.numbering && orderedLevels.length > 0 ? `h${orderedLevels[0]}-counter` : null;
    let counterCSS = "";
    if (h.numbering) {
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
    }

    const tp = styleConfig.titlePage ?? {};
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
        headingCSS,
        blockCSS,
        counterCSS,
    ].join("\n");
}

