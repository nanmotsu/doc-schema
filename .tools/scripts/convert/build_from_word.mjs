/**
 * Word (.docx) -> Markdown build script
 *
 * Usage:
 *   node build_from_word.mjs <input.docx>
 *
 * Behavior:
 * - Writes Markdown next to the source file.
 * - Output file name uses English reverse suffix to avoid overwriting original Markdown.
 *   Example: spec.docx -> spec_reverse.md
 * - Extracted images are written under ./assets by default.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "fs";
import { basename, dirname, extname, join, resolve } from "path";

import mammoth from "mammoth";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const args = process.argv.slice(2);
const inputArg = args.find(arg => !arg.startsWith("--"));

if (!inputArg) {
    console.error("Usage: node build_from_word.mjs <input.docx>");
    process.exit(1);
}

const inputPath = resolve(inputArg);
if (!existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
}
if (extname(inputPath).toLowerCase() !== ".docx") {
    console.error(`Only .docx is supported: ${inputPath}`);
    process.exit(1);
}

const srcDir = dirname(inputPath);
const baseName = basename(inputPath, extname(inputPath));

function ensureExistingDirectory(pathValue, keyName) {
    if (!existsSync(pathValue)) {
        console.error(`Directory does not exist (${keyName}): ${pathValue}`);
        process.exit(1);
    }

    let isDir = false;
    try {
        isDir = statSync(pathValue).isDirectory();
    } catch {
        isDir = false;
    }

    if (!isDir) {
        console.error(`Not a directory (${keyName}): ${pathValue}`);
        process.exit(1);
    }
}

function uniquePath(dirPath, fileName) {
    const target = join(dirPath, fileName);
    if (!existsSync(target)) return target;

    const stem = basename(fileName, extname(fileName));
    const extension = extname(fileName);
    let idx = 1;
    while (true) {
        const candidate = join(dirPath, `${stem}_${idx}${extension}`);
        if (!existsSync(candidate)) return candidate;
        idx += 1;
    }
}

function decodeHtmlEntities(text) {
    return String(text)
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function normalizeCellHtml(cellHtml) {
    const withBreaks = String(cellHtml)
        .replace(/<\/p>\s*<p[^>]*>/gi, "<br>")
        .replace(/<\/div>\s*<div[^>]*>/gi, "<br>");

    const withoutContainers = withBreaks
        .replace(/<\/?p[^>]*>/gi, "")
        .replace(/<\/?div[^>]*>/gi, "");

    const keepBreaks = withoutContainers.replace(/<br\s*\/?>/gi, "__MD_TBL_BR__");
    const noTags = keepBreaks.replace(/<[^>]+>/g, "");

    return decodeHtmlEntities(noTags)
        .replace(/\|/g, "\\|")
        .replace(/\s*__MD_TBL_BR__\s*/g, "<br>")
        .replace(/[ \t]+/g, " ")
        .trim();
}

function htmlTableToMarkdown(tableHtml) {
    const rows = [];
    const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;

    while ((trMatch = trRegex.exec(tableHtml)) !== null) {
        const rowHtml = trMatch[1];
        const cells = [];
        const cellRegex = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
        let cellMatch;

        while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
            cells.push(normalizeCellHtml(cellMatch[2]));
        }

        if (cells.length > 0) rows.push(cells);
    }

    if (rows.length === 0) return tableHtml;

    const colCount = Math.max(...rows.map(r => r.length));
    const paddedRows = rows.map(row => {
        const r = [...row];
        while (r.length < colCount) r.push("");
        return r;
    });

    const header = paddedRows[0];
    const bodyRows = paddedRows.slice(1);
    const headerLine = `| ${header.join(" | ")} |`;
    const separatorLine = `| ${Array(colCount).fill("---").join(" | ")} |`;
    const bodyLines = bodyRows.map(row => `| ${row.join(" | ")} |`);

    return [headerLine, separatorLine, ...bodyLines].join("\n");
}

function replaceHtmlTablesWithMarkdown(markdown) {
    return String(markdown).replace(/<table\b[\s\S]*?<\/table>/gi, tableHtml => {
        const converted = htmlTableToMarkdown(tableHtml);
        return `\n${converted}\n`;
    });
}

const outputFileName = `${baseName}_reverse.md`;
const outputPath = uniquePath(srcDir, outputFileName);
const outputBaseName = basename(outputPath, extname(outputPath));

const assetsRootDir = join(srcDir, "assets");
if (!existsSync(assetsRootDir)) {
    mkdirSync(assetsRootDir, { recursive: true });
}
ensureExistingDirectory(assetsRootDir, "assets");

const assetsDir = join(assetsRootDir, outputBaseName);
if (!existsSync(assetsDir)) {
    mkdirSync(assetsDir, { recursive: true });
}
ensureExistingDirectory(assetsDir, "assets/<output-markdown-name>");

let imageIndex = 1;
const conversion = await mammoth.convertToHtml(
    { path: inputPath },
    {
        convertImage: mammoth.images.imgElement(async image => {
            const extension = image.contentType.split("/")[1] || "png";
            const normalizedExt = extension === "jpeg" ? "jpg" : extension;
            const rawFileName = `${baseName}_reverse_img_${String(imageIndex).padStart(3, "0")}.${normalizedExt}`;
            imageIndex += 1;

            const imagePath = uniquePath(assetsDir, rawFileName);
            const imageBuffer = await image.readAsBuffer();
            writeFileSync(imagePath, imageBuffer);

            return { src: `assets/${outputBaseName}/${basename(imagePath)}` };
        }),
    }
);

if (conversion.messages.length > 0) {
    for (const msg of conversion.messages) {
        console.warn(`[mammoth:${msg.type}] ${msg.message}`);
    }
}

const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
});

turndown.use(gfm);

const markdownBody = turndown
    .turndown(conversion.value)
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .trim();

const markdownWithTableSyntax = replaceHtmlTablesWithMarkdown(markdownBody)
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const sourceNote = `<!-- Generated from ${basename(inputPath)} by build_from_word.mjs -->`;
const outputMarkdown = `${sourceNote}\n\n${markdownWithTableSyntax}\n`;

writeFileSync(outputPath, outputMarkdown, "utf-8");
console.log(`✓ Markdown: ${outputPath}`);
console.log(`✓ Assets: ${assetsDir}`);
