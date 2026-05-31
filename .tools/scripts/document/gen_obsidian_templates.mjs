/**
 * Obsidianテンプレート生成スクリプト
 *
 * schemas/*.json の body 配列を結合して
 * obsidian_template/{prefix}_テンプレ.md を生成する
 *
 * 使い方:
 *   node gen_obsidian_templates.mjs
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCHEMA_DIR = join(__dirname, "..", "..", "..", "000_schema", "document", "schemas");
const OUTPUT_DIR = join(__dirname, "..", "..", "..", "000_schema", "document", "obsidian_template");
const LEGACY_SCHEMA_KEYS = new Set(["source", "task_impl"]);

// 出力ディレクトリがなければ作成
if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
}

const schemaFiles = readdirSync(SCHEMA_DIR).filter(f => f.endsWith(".json"));

let generatedCount = 0;
let skippedCount = 0;

for (const file of schemaFiles) {
    const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, file), "utf-8"));

    if (LEGACY_SCHEMA_KEYS.has(schema.key)) {
        console.log(`  スキップ: ${file} (legacy schema)`);
        skippedCount++;
        continue;
    }

    if (!Array.isArray(schema.body) || schema.body.length === 0) {
        console.log(`  スキップ: ${file} (body なし)`);
        skippedCount++;
        continue;
    }

    const content = schema.body
        .join("\n")
        .replace(/\{\{id\}\}/g, schema.idExample ?? schema.prefix)
        .replace(/\{\{status\}\}/g, schema.defaultStatus ?? "");
    const outFile = join(OUTPUT_DIR, `${schema.prefix}_テンプレ.md`);

    writeFileSync(outFile, content, "utf-8");
    console.log(`  生成: ${schema.prefix}_テンプレ.md  (${schema.label})`);
    generatedCount++;
}

console.log(`\n完了: ${generatedCount} 件生成、${skippedCount} 件スキップ`);
