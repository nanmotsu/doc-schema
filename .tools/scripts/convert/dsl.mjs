/**
 * 独自DSL変換モジュール（スキーマ駆動版）
 *
 * ブロック定義は 000_schema/convert/dsl.json から読み込む。
 * ハードコードを排除し、dsl.json を編集するだけで挙動を変更できる。
 *
 * :::type
 * ...content...
 * :::
 * を HTML に変換する。content 部分は parseFn（marked.parse）で再帰処理。
 */
import { readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dslConfig = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "..", "000_schema", "convert", "dsl.json"), "utf-8")
);
/** name → block定義 のマップ */
const blockMap = new Map(dslConfig.blocks.map(b => [b.name, b]));

/**
 * 開きタグの属性文字列（例: "width=80% height=200px"）を
 * { width: '80%', height: '200px' } なマップにパースする
 * @param {string} attrStr
 * @returns {Record<string, string>}
 */
function parseAttrs(attrStr) {
    const result = {};
    for (const m of attrStr.matchAll(/(\w+)=([^\s]+)/g)) {
        result[m[1]] = m[2];
    }
    return result;
}

/**
 * ドキュメントを [markdown|dsl] セグメントに分割する
 * 開きタグの後ろに属性を記述可能: :::figure width=80%
 * @param {string} src
 * @returns {{ kind: 'md'|'dsl', text?: string, type?: string, attrs?: Record<string,string>, content?: string }[]}
 */
function splitSegments(src) {
    const segments = [];
    const re = /^:::(\w+)([^\n]*)\n([\s\S]*?)^:::/gm;
    let last = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
        if (m.index > last) {
            segments.push({ kind: 'md', text: src.slice(last, m.index) });
        }
        segments.push({ kind: 'dsl', type: m[1], attrs: parseAttrs(m[2]), content: m[3] });
        last = m.index + m[0].length;
    }
    if (last < src.length) {
        segments.push({ kind: 'md', text: src.slice(last) });
    }
    return segments;
}

/**
 * DSL ブロックを dsl.json の定義に基づいて HTML に変換する
 * switch/case の代わりにスキーマのプロパティで分岐する
 * @param {string} type
 * @param {Record<string,string>} attrs  開きタグ属性（例: { width: '80%', origin: 'internal' }）
 * @param {string} content
 * @param {function(string): string} parseFn
 * @param {{ internalAbs?: string|null, externalBase?: string|null }} ctx  アセットルートコンテキスト
 */
function buildBlock(type, attrs, content, parseFn, ctx = {}) {
    const block = blockMap.get(type);
    // 未知のブロックはそのままdiv変換（フォールバック）
    if (!block) return `<div class="${type}">\n${parseFn(content.trimEnd())}</div>`;

    const trimmed = content.trimEnd();

    // selfClosing: :::pagebreak:::
    if (block.selfClosing) {
        return `<${block.element} class="${block.class}"></${block.element}>`;
    }

    // captionPosition="bottom": figure（画像 + 下キャプション）
    if (block.captionPosition === "bottom") {
        // width / height: 属性指定 → スキーマ defaults → 未指定
        const defaults = block.defaults ?? {};
        const width = attrs.width ?? defaults.width ?? null;
        const height = attrs.height ?? defaults.height ?? null;
        const sizeStyle = buildSizeStyle(width, height);

        // align: left / center / right（省略時は CSS クラスのデフォルト = center）
        const align = attrs.align ?? null;

        const lines = trimmed.split('\n');
        const imgLine = lines.find(l => /^!\[/.test(l.trim())) ?? '';
        const captionLines = lines.filter(l => !/^!\[/.test(l.trim()) && l.trim()).join(' ').trim();

        // marked.parse が出力する <img> に style 属性を注入
        let imgHtml = parseFn(imgLine).trim().replace(/<img(\s)/i, `<img style="${sizeStyle}"$1`);

        // origin 属性によるパス解決
        // origin=internal → ctx.internalAbs（プロジェクトルート起点）で file:/// に変換
        // origin=external → ctx.externalBase（外部 URL/パス起点）を先頭に付与
        const origin = attrs.origin;
        if (origin) {
            const root = origin === 'internal' ? (ctx.internalAbs ?? null) : (ctx.externalBase ?? null);
            if (root) {
                imgHtml = imgHtml.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/gi, (_, pre, src, post) => {
                    if (/^(https?:|file:|data:)/i.test(src)) return pre + src + post;
                    const clean = src.replace(/^\.\//,  "");
                    if (origin === 'internal') {
                        const abs = resolve(root, clean).replace(/\\/g, "/");
                        return `${pre}file:///${abs}${post}`;
                    } else {
                        // HTTP(S) URL はそのまま連結、ローカルパス（C:ドライブ等）は file:/// に変換
                        if (/^https?:/i.test(root)) {
                            const sep = root.endsWith('/') ? '' : '/';
                            return `${pre}${root}${sep}${clean}${post}`;
                        }
                        const abs = resolve(root, clean).replace(/\\/g, "/");
                        return `${pre}file:///${abs}${post}`;
                    }
                });
            }
        }

        const alignStyle = align ? ` style="text-align:${align}"` : '';
        return [
            `<${block.element} class="${block.class}"${alignStyle}>`,
            imgHtml,
            captionLines ? `<figcaption>${captionLines}</figcaption>` : '',
            `</${block.element}>`,
        ].filter(Boolean).join('\n');
    }

    // captionPosition="top": table（上キャプション + 表）
    if (block.captionPosition === "top") {
        const lines = trimmed.split('\n');
        const caption = lines[0]?.trim() ?? '';
        const bodyMd = lines.slice(1).join('\n');
        const tableFontSize = attrs.fontSize ?? attrs.tableFontSize ?? null;
        const colWidthRaw = attrs.colRatio ?? attrs.colWidths ?? null;
        const colWidths = parseColumnWidths(colWidthRaw);

        let tableHtml = parseFn(bodyMd).trim();
        if (tableFontSize) {
            tableHtml = appendStyleToFirstTable(tableHtml, `font-size:${tableFontSize}`);
        }
        if (colWidths.length > 0) {
            tableHtml = injectColgroupToFirstTable(tableHtml, colWidths);
        }

        return [
            `<${block.element} class="${block.class}">`,
            `<p class="table-caption">${caption}</p>`,
            tableHtml,
            `</${block.element}>`,
        ].join('\n');
    }

    // デフォルト: 通常ブロック（attrs.width でインライン幅指定可能）
    const inlineStyle = attrs.width ? ` style="max-width:${attrs.width}"` : '';
    return `<${block.element} class="${block.class}"${inlineStyle}>\n${parseFn(trimmed)}</${block.element}>`;
}

/**
 * width / height 値から img 用の style 文字列を組み立てる
 * max-width:100% は常に付与して画面幅オーバーを防ぐ
 */
function buildSizeStyle(width, height) {
    const parts = ['max-width:100%'];
    if (width) parts.push(`width:${width}`);
    if (height && height !== 'auto') parts.push(`height:${height}`);
    return parts.join(';');
}

/**
 * 先頭の <table> タグへ style を追記する。
 */
function appendStyleToFirstTable(tableHtml, styleChunk) {
    if (!styleChunk) return tableHtml;
    return tableHtml.replace(/<table\b([^>]*)>/i, (match, attrs) => {
        if (/\sstyle="/i.test(attrs)) {
            return `<table${attrs.replace(/\sstyle="([^"]*)"/i, (_m, s) => ` style="${s}; ${styleChunk}"`)}>`;
        }
        return `<table${attrs} style="${styleChunk}">`;
    });
}

/**
 * 列幅比率文字列を列幅配列へ変換する。
 * 例: "2,3,1" -> ["33.3333%","50%","16.6667%"]
 */
function parseColumnWidths(raw) {
    if (!raw) return [];
    const tokens = String(raw)
        .split(/[,:]/)
        .map(v => v.trim())
        .filter(Boolean);
    if (tokens.length === 0) return [];

    const numeric = tokens.map(v => Number(v));
    const allNumeric = numeric.every(v => Number.isFinite(v) && v > 0);
    if (allNumeric) {
        const total = numeric.reduce((sum, v) => sum + v, 0);
        return numeric.map(v => `${(v / total) * 100}%`);
    }

    return tokens;
}

/**
 * 先頭の <table> タグ直後へ colgroup を挿入する。
 */
function injectColgroupToFirstTable(tableHtml, widths) {
    if (!Array.isArray(widths) || widths.length === 0) return tableHtml;
    const colgroup = `<colgroup>${widths.map(w => `<col style="width:${w}">`).join('')}</colgroup>`;
    return tableHtml.replace(/<table\b([^>]*)>/i, `<table$1>${colgroup}`);
}

/**
 * Markdown ソースに含まれる独自DSLブロックを HTML に変換する
 *
 * @param {string} markdown
 * @param {function(string): string} parseFn  - marked.parse などの Markdown→HTML 関数
 * @param {{ internalAbs?: string|null, externalBase?: string|null }} ctx  アセットルートコンテキスト
 * @returns {string} HTML
 */
export function transformDSL(markdown, parseFn, ctx = {}) {
    const segments = splitSegments(markdown);
    return segments
        .map(seg => {
            if (seg.kind === 'md') return parseFn(seg.text);
            return buildBlock(seg.type, seg.attrs, seg.content, parseFn, ctx);
        })
        .join('\n');
}
