/**
 * 共通定義 - schemas/*.json から動的に構築
 */
import { resolve, dirname, join } from "path";
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const WORKSPACE = resolve(__dirname, "..", "..", "..");
export const SCHEMA_DIR = join(__dirname, "..", "..", "..", "000_schema", "document", "schemas");

/**
 * プロジェクトとして扱わない 3 桁プレフィックスの除外リスト
 */
export const EXCLUDED_PREFIXES = ["000", "997", "998", "999"];

/**
 * 新規プロジェクト作成時のフォルダ構成
 * （999_フォルダ構成について/フォルダ構成 に準拠）
 */
export const PROJECT_FOLDER_STRUCTURE = [
    "src",
    "tests",
    "docs/00_project",
    "docs/10_specs/product_baseline",
    "docs/10_specs/requirements",
    "docs/10_specs/issues",
    "docs/10_specs/risks",
    "docs/10_specs/decisions",
    "docs/10_specs/changes/level1_tickets",
    "docs/10_specs/changes/level2_changes",
    "docs/10_specs/changes/level3_projects",
    "docs/20_tests/master_test_cases",
    "docs/30_operations/setup",
    "docs/30_operations/deploy",
    "docs/30_operations/runbook",
    "docs/30_operations/manual",
    "docs/40_customer_outputs",
    "docs/50_meetings",
    "docs/60_release/baseline_snapshots",
    "docs/90_generated",
];

export const PROJECT_BOOTSTRAP_FILES = [
    { path: "README.md", content: "# Project\n" },
    { path: "docs/00_project/README.md", content: "# 00 Project\n" },
    { path: "docs/00_project/glossary.md", content: "# Glossary\n" },
    { path: "docs/00_project/overview.md", content: "# Overview\n" },
    { path: "docs/10_specs/product_baseline/README.md", content: "# Product Baseline Specs\n" },
    { path: "docs/10_specs/requirements/README.md", content: "# Requirements\n" },
    { path: "docs/10_specs/issues/README.md", content: "# Issues\n" },
    { path: "docs/10_specs/risks/README.md", content: "# Risks\n" },
    { path: "docs/10_specs/decisions/README.md", content: "# Decisions\n" },
    { path: "docs/10_specs/changes/README.md", content: "# Changes\n" },
    { path: "docs/10_specs/changes/level1_tickets/README.md", content: "# Level 1 Tickets\n" },
    { path: "docs/10_specs/changes/level2_changes/README.md", content: "# Level 2 Changes\n" },
    { path: "docs/10_specs/changes/level3_projects/README.md", content: "# Level 3 Projects\n" },
    { path: "docs/20_tests/README.md", content: "# Tests\n" },
    { path: "docs/30_operations/README.md", content: "# Operations\n" },
    { path: "docs/30_operations/setup/README.md", content: "# Setup\n" },
    { path: "docs/30_operations/setup/SETUP-LOCAL.md", content: "# Setup Local\n" },
    { path: "docs/30_operations/setup/SETUP-SERVER.md", content: "# Setup Server\n" },
    { path: "docs/30_operations/setup/ENV-VARIABLES.md", content: "# Environment Variables\n" },
    { path: "docs/30_operations/deploy/README.md", content: "# Deploy\n" },
    { path: "docs/30_operations/deploy/RELEASE-CHECKLIST.md", content: "# Release Checklist\n" },
    { path: "docs/30_operations/runbook/README.md", content: "# Runbook\n" },
    { path: "docs/30_operations/runbook/INCIDENT-RESPONSE.md", content: "# Incident Response\n" },
    { path: "docs/30_operations/runbook/BACKUP-RESTORE.md", content: "# Backup Restore\n" },
    { path: "docs/30_operations/runbook/MONITORING.md", content: "# Monitoring\n" },
    { path: "docs/30_operations/manual/README.md", content: "# Manual\n" },
    { path: "docs/30_operations/manual/MANUAL-ADMIN.md", content: "# Manual Admin\n" },
    { path: "docs/30_operations/manual/MANUAL-USER.md", content: "# Manual User\n" },
    { path: "docs/30_operations/manual/FAQ.md", content: "# FAQ\n" },
    { path: "docs/40_customer_outputs/README.md", content: "# Customer Outputs\n" },
    { path: "docs/50_meetings/README.md", content: "# Meetings\n" },
    { path: "docs/60_release/README.md", content: "# Release\n" },
];

// schemas/*.json をすべて読み込む
const _rawDefs = readdirSync(SCHEMA_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(readFileSync(join(SCHEMA_DIR, f), "utf-8")));
const _defsByKey = Object.fromEntries(_rawDefs.map(d => [d.key, d]));

// getDocTypes の表示順を固定（ファイルシステムの列挙順に依存しない）
const DOC_TYPE_ORDER = [
    "requirement",
    "specification",
    "test_case",
    "issue",
    "risk",
    "decision",
    "ticket_level1",
    "change_level2",
    "mod_project",
    "runbook",
    "manual",
    "customer_artifact",
    "release_note",
    "meeting_note",
];

// ファイル名パターン → スキーマキー（prefix と numbering から導出）
export const SCHEMA_MAP = DOC_TYPE_ORDER
    .filter(k => _defsByKey[k])
    .map(k => {
        const d = _defsByKey[k];
        const pattern = d.numbering === "seq"
            ? new RegExp(`^${d.prefix}-\\d{3}`)
            : new RegExp(`^${d.prefix}-`);
        return { pattern, key: k };
    });

/**
 * スキーマキーに対応する JSON Schema を返す
 * @param {string} key
 * @returns {object | null}
 */
export function getSchema(key) {
    return _defsByKey[key]?.schema ?? null;
}

/**
 * ワークスペース直下の有効なプロジェクト一覧を返す
 * （3桁数字プレフィックスを持つフォルダ。EXCLUDED_PREFIXES に含まれるものは除外）
 * @returns {{ name: string, dir: string }[]}
 */
export function getProjects() {
    try {
        return readdirSync(WORKSPACE, { withFileTypes: true })
            .filter(e =>
                e.isDirectory() &&
                /^\d{3}_/.test(e.name) &&
                !EXCLUDED_PREFIXES.includes(e.name.slice(0, 3))
            )
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(e => ({ name: e.name, dir: join(WORKSPACE, e.name) }));
    } catch {
        return [];
    }
}

/**
 * プロジェクトを名前または番号プレフィックスで検索する
 * @param {string} arg - プロジェクト名 ("001_blueberry_system") または数字プレフィックス ("001")
 * @returns {{ name: string, dir: string } | null}
 */
export function findProject(arg) {
    if (!arg) return null;
    const projects = getProjects();
    return projects.find(p =>
        p.name === arg ||
        p.name.startsWith(arg + "_") ||
        p.dir === arg
    ) ?? null;
}

function buildIdPattern(prefix, numbering) {
    if (numbering === "seq") return (n) => `${prefix}-${String(n).padStart(3, "0")}`;
    if (numbering === "year_seq") return (n, year) => `${prefix}-${year}-${String(n).padStart(3, "0")}`;
    if (numbering === "name") return (name) => `${prefix}-${name}`;
    return null;
}

function buildIdRegex(prefix, numbering) {
    if (numbering === "seq") return new RegExp(`^${prefix}-(\\d{3})`);
    if (numbering === "year_seq") return new RegExp(`^${prefix}-(\\d{4})-(\\d{3})`);
    if (numbering === "name") return new RegExp(`^${prefix}-(.+)`);
    return new RegExp(`^${prefix}-`);
}

function extractDefaultVisibility(templateLines) {
    const lines = Array.isArray(templateLines) ? templateLines : String(templateLines || "").split("\n");
    const line = lines.find((entry) => /^visibility:\s*/.test(entry));
    if (!line) return null;
    return line.replace(/^visibility:\s*/, "").trim() || null;
}

function extractArrayFields(schema) {
    const properties = schema?.properties ?? {};
    return Object.entries(properties)
        .filter(([key, value]) => key !== "tags" && value?.type === "array" && value?.items?.type === "string")
        .map(([key, value]) => ({
            key,
            pattern: value.items?.pattern ? new RegExp(value.items.pattern) : null,
        }));
}

function replaceYamlListSection(content, key, items) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sectionRegex = new RegExp(`^${escapedKey}:\\s*\\r?\\n(?:\\s{2}-.*\\r?\\n?)*`, "m");
    if (!sectionRegex.test(content)) return content;
    const normalizedItems = Array.isArray(items) ? items.filter(Boolean) : [];
    const replacement = normalizedItems.length > 0
        ? `${key}:\n${normalizedItems.map((item) => `  - ${item}`).join("\n")}\n`
        : `${key}:\n  - \n`;
    return content.replace(sectionRegex, replacement);
}

function toWikiLinkRef(value) {
    if (typeof value !== "string") return null;
    let ref = value.trim();
    if (!ref) return null;
    if (ref.startsWith("[[") && ref.endsWith("]]")) {
        ref = ref.slice(2, -2).split("|")[0].trim();
    }
    if (ref.toLowerCase().endsWith(".md")) {
        ref = ref.slice(0, -3);
    }
    if (!ref) return null;
    return `"[[${ref}]]"`;
}

function buildBodyFn(templateLines) {
    const template = Array.isArray(templateLines) ? templateLines.join("\n") : templateLines;
    return (id, status, linked, date, title, meta = {}) => {
        const linkedStr = linked.filter(l => l).map(l => `- ${l}`).join("\n") || "- ";
        let content = template
            .replace(/\{\{id\}\}/g, id)
            .replace(/\{\{status\}\}/g, status ?? "")
            .replace(/\{\{date\}\}/g, date)
            .replace(/\{\{title\}\}/g, title)
            .replace(/\{\{linked\}\}/g, linkedStr);

        if (/^owner:\s*$/m.test(content)) {
            content = content.replace(/^owner:\s*$/m, `owner: ${meta.owner || "TBD"}`);
        }
        if (meta.visibility && /^visibility:\s*.+$/m.test(content)) {
            content = content.replace(/^visibility:\s*.+$/m, `visibility: ${meta.visibility}`);
        }
        if (meta.tags && /^tags:\s*\r?\n/m.test(content)) {
            content = replaceYamlListSection(content, "tags", meta.tags);
        }
        if (meta.links && typeof meta.links === "object") {
            for (const [key, items] of Object.entries(meta.links)) {
                content = replaceYamlListSection(content, key, items);
            }
        }

        return content;
    };
}

function buildDocType(def, projectDir) {
    return {
        key: def.key,
        label: def.label,
        prefix: def.prefix,
        dir: join(projectDir, ...def.dirParts),
        idPattern: buildIdPattern(def.prefix, def.numbering),
        idRegex: buildIdRegex(def.prefix, def.numbering),
        statuses: def.statuses ?? null,
        defaultStatus: def.defaultStatus,
        ownerSupported: Boolean(def.schema?.properties?.owner),
        tagSupported: Boolean(def.schema?.properties?.tags),
        visibilityOptions: def.schema?.properties?.visibility?.enum ?? null,
        defaultVisibility: extractDefaultVisibility(def.body),
        linkFields: extractArrayFields(def.schema),
        sourceTypes: def.sourceTypes ?? null,
        numbering: def.numbering,
        body: buildBodyFn(def.body),
    };
}

/**
 * プロジェクトディレクトリを受け取り、ドキュメント種別定義の配列を返す
 * @param {string} projectDir - プロジェクトのルートディレクトリ（絶対パス）
 * @returns {object[]}
 */
export function getDocTypes(projectDir) {
    return DOC_TYPE_ORDER
        .filter(k => _defsByKey[k])
        .map(k => buildDocType(_defsByKey[k], projectDir));
}

export { toWikiLinkRef };
