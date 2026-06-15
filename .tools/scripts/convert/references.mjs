/**
 * DSL参照（figure/table）を解決するユーティリティ。
 *
 * 対応プレースホルダー:
 * - {{ref:my-id}}
 * - [[ref:my-id]]
 */

function parseAttrs(attrStr) {
    const result = {};
    for (const m of String(attrStr ?? "").matchAll(/(\w+)=("[^"]*"|'[^']*'|[^\s]+)/g)) {
        const raw = m[2] ?? "";
        result[m[1]] = raw.replace(/^['"]|['"]$/g, "");
    }
    return result;
}

function getOrderedHeadingLevels(headingConfig) {
    return (headingConfig?.levels || ["h1", "h2", "h3"])
        .map(l => parseInt(String(l).replace("h", ""), 10))
        .filter(n => n >= 1 && n <= 3)
        .sort((a, b) => a - b);
}

function createPrefixMap(dslBlocks) {
    const prefixMap = new Map();
    for (const b of dslBlocks || []) {
        if (!b?.name) continue;
        prefixMap.set(b.name, b.captionPrefix || "");
    }
    return prefixMap;
}

function buildLabel(type, count, sectionNo, numberingEnabled, prefixMap) {
    const prefix = prefixMap.get(type) || "";
    if (numberingEnabled && sectionNo !== null && sectionNo !== undefined) {
        return `${prefix}${sectionNo}.${count}`;
    }
    return prefix || type;
}

/**
 * markdown本文を走査し、:::figure / :::table の id を番号へ解決する。
 */
export function resolveDslReferences(markdown, options = {}) {
    const src = String(markdown ?? "");
    const headingConfig = options.headingConfig || {};
    const dslBlocks = options.dslBlocks || [];

    const orderedLevels = getOrderedHeadingLevels(headingConfig);
    const numberingEnabled = !!headingConfig?.numbering && orderedLevels.length > 0;
    const topLevel = numberingEnabled ? orderedLevels[0] : null;
    const prefixMap = createPrefixMap(dslBlocks);

    const headingCounters = {};
    for (const lv of orderedLevels) headingCounters[lv] = 0;

    let figureCounter = 0;
    let tableCounter = 0;

    const refMap = new Map();
    const duplicates = [];
    const lines = src.split(/\r?\n/);

    let inCodeFence = false;
    let hideDepth = 0;

    const isOpenDsl = (t) => /^:::\w/.test(t);
    const isCloseDsl = (t) => /^:::(?!\w)/.test(t);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const t = line.trim();

        if (/^```/.test(t)) {
            inCodeFence = !inCodeFence;
            continue;
        }
        if (inCodeFence) continue;

        // :::hide ... ::: は実出力から除外されるため参照カウント対象外にする。
        if (hideDepth > 0) {
            if (isOpenDsl(t)) hideDepth++;
            else if (isCloseDsl(t)) hideDepth--;
            continue;
        }
        if (/^:::hide(?:\s|$)/.test(t)) {
            hideDepth = 1;
            continue;
        }

        const h = t.match(/^(#{1,3})\s+/);
        if (h && numberingEnabled) {
            const level = h[1].length;
            if (orderedLevels.includes(level)) {
                headingCounters[level]++;
                for (const lv of orderedLevels) {
                    if (lv > level) headingCounters[lv] = 0;
                }
                if (level === topLevel) {
                    figureCounter = 0;
                    tableCounter = 0;
                }
            }
            continue;
        }

        const open = line.match(/^:::(\w+)([^\n]*)$/);
        if (!open) continue;

        const type = open[1];
        const attrs = parseAttrs(open[2]);
        if (type === "figure" || type === "table") {
            const id = attrs.id?.trim();
            if (type === "figure") figureCounter++;
            if (type === "table") tableCounter++;

            if (id) {
                const count = type === "figure" ? figureCounter : tableCounter;
                const sectionNo = numberingEnabled ? headingCounters[topLevel] : null;
                const label = buildLabel(type, count, sectionNo, numberingEnabled, prefixMap);
                if (refMap.has(id)) {
                    duplicates.push({ id, line: i + 1, firstLine: refMap.get(id).line });
                } else {
                    refMap.set(id, { type, label, line: i + 1 });
                }
            }
        }

        // ブロック終端までスキップ（ネスト対応）
        let depth = 1;
        let blockInFence = false;
        while (i + 1 < lines.length && depth > 0) {
            i++;
            const b = lines[i].trim();
            if (/^```/.test(b)) {
                blockInFence = !blockInFence;
                continue;
            }
            if (blockInFence) continue;
            if (isOpenDsl(b)) depth++;
            else if (isCloseDsl(b)) depth--;
        }
    }

    if (duplicates.length > 0) {
        const details = duplicates
            .map(d => `id='${d.id}' (first:${d.firstLine}, dup:${d.line})`)
            .join(", ");
        throw new Error(`参照IDが重複しています: ${details}`);
    }

    const unknownRefs = new Set();
    const replaced = src.replace(/\{\{ref:([A-Za-z0-9._-]+)\}\}|\[\[ref:([A-Za-z0-9._-]+)\]\]/g, (_, a, b) => {
        const id = a || b;
        const found = refMap.get(id);
        if (!found) {
            unknownRefs.add(id);
            return _;
        }
        return found.label;
    });

    return {
        markdown: replaced,
        unknownRefs: Array.from(unknownRefs),
        referenceCount: refMap.size,
    };
}
