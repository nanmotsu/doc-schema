/**
 * スニペット生成スクリプト
 *
 * 000_schema/convert/dsl.json のブロック定義から
 * .vscode/markdown.code-snippets を生成する。
 *
 * Usage: node gen_snippets.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONVERT_SCHEMA = join(__dirname, "..", "..", "..", "000_schema", "convert");
const VSCODE_DIR = join(__dirname, "..", "..", "..", ".vscode");
const OUTPUT_PATH = join(VSCODE_DIR, "markdown.code-snippets");

const dslConfig = JSON.parse(readFileSync(join(CONVERT_SCHEMA, "dsl.json"), "utf-8"));

// snippet オブジェクトを組み立て（snippet / snippetExt / snippetN... をすべて処理）
const snippets = {};
for (const block of dslConfig.blocks) {
    // "snippet" で始まるキーをすべて列挙して登録
    for (const [key, snip] of Object.entries(block)) {
        if (!key.startsWith("snippet") || typeof snip !== "object" || !snip.prefix) continue;
        const id = key === "snippet" ? block.name : `${block.name}_${key.replace(/^snippet/, "").toLowerCase()}`;
        snippets[id] = { prefix: snip.prefix, description: snip.description, body: snip.body, scope: "markdown" };
    }
}

mkdirSync(VSCODE_DIR, { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(snippets, null, 4), "utf-8");
console.log(`✓ スニペット生成: ${OUTPUT_PATH}`);
console.log(`  ${Object.keys(snippets).length} 件のスニペットを登録しました。`);
