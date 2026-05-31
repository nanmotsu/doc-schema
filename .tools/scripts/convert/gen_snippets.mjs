/**
 * スニペット生成スクリプト
 *
 * 1) 000_schema/convert/dsl.json から Markdown DSL スニペット
 * 2) 000_schema/document/schemas/*.json から文書 front matter スニペット
 * 3) 000_schema/document/flows.json からフェーズ補助スニペット
 *
 * を生成する。
 *
 * Usage: node gen_snippets.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONVERT_SCHEMA = join(__dirname, "..", "..", "..", "000_schema", "convert");
const DOCUMENT_SCHEMA = join(__dirname, "..", "..", "..", "000_schema", "document");
const VSCODE_DIR = join(__dirname, "..", "..", "..", ".vscode");
const OUTPUT_MARKDOWN = join(VSCODE_DIR, "markdown.code-snippets");
const OUTPUT_DOCS = join(VSCODE_DIR, "project-docs.code-snippets");
const OUTPUT_TEST_SPEC = join(VSCODE_DIR, "test_spec.code-snippets");

const dslConfig = JSON.parse(readFileSync(join(CONVERT_SCHEMA, "dsl.json"), "utf-8"));
const flows = JSON.parse(readFileSync(join(DOCUMENT_SCHEMA, "flows.json"), "utf-8")).flows || [];

const STANDARD_STATUS_CODES = ["draft", "review", "approved", "active", "deprecated", "closed"];
const VISIBILITY_CODES = ["internal", "customer", "partial", "confidential"];

function toSnippetBody(body) {
    return Array.isArray(body) ? body : String(body || "").split(/\r?\n/);
}

function makeChoice(index, values, fallback = "") {
    if (!Array.isArray(values) || values.length === 0) return `\${${index}:${fallback}}`;
    return `\${${index}|${values.join(",")}|}`;
}

function makePlaceholder(index, value) {
    return `\${${index}:${value}}`;
}

function normalizeStatuses(statuses) {
    if (!Array.isArray(statuses)) return [];
    return statuses
        .map((item) => typeof item === "string" ? item : item?.code)
        .filter(Boolean);
}

function buildTemplateBody(def) {
    const statuses = normalizeStatuses(def.statuses);
    const statusChoices = statuses.length > 0 ? statuses : STANDARD_STATUS_CODES;
    const lines = toSnippetBody(def.body);

    return lines.map((line) => {
        let next = line;
        next = next.replace("{{id}}", makePlaceholder(1, def.idExample || `${def.prefix}-...`));
        next = next.replace("{{title}}", makePlaceholder(2, "タイトル"));
        next = next.replace("{{status}}", makeChoice(3, statusChoices, def.defaultStatus || "draft"));
        next = next.replace(/created_at:\s*\{\{date\}\}/, `created_at: ${makePlaceholder(4, "2026-01-01")}`);
        next = next.replace(/updated_at:\s*\{\{date\}\}/, `updated_at: ${makePlaceholder(4, "2026-01-01")}`);
        if (/^owner:\s*$/.test(next)) next = `owner: ${makePlaceholder(5, "TBD")}`;
        next = next.replace(/^visibility:\s*internal$/, `visibility: ${makeChoice(6, VISIBILITY_CODES, "internal")}`);
        return next;
    });
}

function buildDslSnippets() {
    const snippets = {};
    for (const block of dslConfig.blocks || []) {
        for (const [key, snip] of Object.entries(block)) {
            if (!key.startsWith("snippet") || typeof snip !== "object" || !snip.prefix) continue;
            const id = key === "snippet" ? block.name : `${block.name}_${key.replace(/^snippet/, "").toLowerCase()}`;
            snippets[id] = {
                prefix: snip.prefix,
                description: snip.description,
                body: toSnippetBody(snip.body),
                scope: "markdown",
            };
        }
    }
    return snippets;
}

function buildDocumentSnippets() {
    const snippets = {};
    const schemaDir = join(DOCUMENT_SCHEMA, "schemas");
    const files = readdirSync(schemaDir).filter((f) => f.endsWith(".json")).sort();

    for (const file of files) {
        const def = JSON.parse(readFileSync(join(schemaDir, file), "utf-8"));
        if (!def.key || !def.prefix || !Array.isArray(def.body)) continue;

        const name = `${def.key}_template`;
        const prefix = `doc.${String(def.prefix).toLowerCase()}`;
        snippets[name] = {
            prefix,
            description: `${def.label || def.key} front matter template`,
            body: buildTemplateBody(def),
            scope: "markdown",
        };
    }

    for (const flow of flows) {
        if (!flow?.key) continue;
        snippets[`flow_${flow.key}`] = {
            prefix: `flow.${flow.key}`,
            description: `${flow.label || flow.key} flow steps`,
            body: [
                `# ${flow.label || flow.key}`,
                "",
                `- when: ${flow.when || ""}`,
                "- steps:",
                ...(flow.steps || []).map((s) => `  - ${s}`),
            ],
            scope: "markdown",
        };
    }

    return snippets;
}

function buildFrontMatterHelperSnippets() {
    return {
        "frontmatter_common": {
            prefix: "fm.common",
            description: "Common front matter block for docs-first documents",
            body: [
                "---",
                "id: ${1:REQ-2026-001}",
                "title: ${2:タイトル}",
                "type: ${3:requirement}",
                `status: ${makeChoice(4, STANDARD_STATUS_CODES, "draft")}`,
                "created_at: ${5:2026-01-01}",
                "updated_at: ${5:2026-01-01}",
                "owner: ${6:TBD}",
                "tags:",
                "  - ${7:tag}",
                `visibility: ${makeChoice(8, VISIBILITY_CODES, "internal")}`,
                "---",
            ],
            scope: "markdown",
        },
        "frontmatter_status": {
            prefix: "fm.status",
            description: "status line with standard docs-first values",
            body: [`status: ${makeChoice(1, STANDARD_STATUS_CODES, "draft")}`],
            scope: "markdown",
        },
        "frontmatter_visibility": {
            prefix: "fm.visibility",
            description: "visibility line with supported values",
            body: [`visibility: ${makeChoice(1, VISIBILITY_CODES, "internal")}`],
            scope: "markdown",
        },
        "frontmatter_owner": {
            prefix: "fm.owner",
            description: "owner line with default placeholder",
            body: ["owner: ${1:TBD}"],
            scope: "markdown",
        },
    };
}

function buildMarkdownTestSpecSnippets() {
    return {
        "test_case_markdown": {
            prefix: "test.case.md",
            description: "Markdown test case skeleton (front matter + steps)",
            body: [
                "---",
                "id: TEST-${1:2026-001}",
                "title: ${2:テストケース名}",
                "type: test_case",
                "status: draft",
                "created_at: ${3:2026-01-01}",
                "updated_at: ${3:2026-01-01}",
                "owner: ${4:担当者}",
                "tags:",
                "  -",
                "releases:",
                "  -",
                "visibility: internal",
                "---",
                "",
                "# ${2:テストケース名}",
                "",
                "## 1. 目的",
                "",
                "## 2. 前提条件",
                "",
                "## 3. 手順",
                "",
                "| No | 操作 | 入力値 | 期待結果 |",
                "|---:|---|---|---|",
                "| 1 | ${5:操作} | ${6:入力} | ${7:期待結果} |",
            ],
            scope: "markdown",
        },
    };
}

const markdownSnippets = buildDslSnippets();
const documentSnippets = {
    ...buildDocumentSnippets(),
    ...buildFrontMatterHelperSnippets(),
};
const testSpecSnippets = buildMarkdownTestSpecSnippets();

mkdirSync(VSCODE_DIR, { recursive: true });
writeFileSync(OUTPUT_MARKDOWN, JSON.stringify(markdownSnippets, null, 4), "utf-8");
writeFileSync(OUTPUT_DOCS, JSON.stringify(documentSnippets, null, 4), "utf-8");
writeFileSync(OUTPUT_TEST_SPEC, JSON.stringify(testSpecSnippets, null, 4), "utf-8");

console.log(`✓ スニペット生成: ${OUTPUT_MARKDOWN} (${Object.keys(markdownSnippets).length}件)`);
console.log(`✓ スニペット生成: ${OUTPUT_DOCS} (${Object.keys(documentSnippets).length}件)`);
console.log(`✓ スニペット生成: ${OUTPUT_TEST_SPEC} (${Object.keys(testSpecSnippets).length}件)`);
