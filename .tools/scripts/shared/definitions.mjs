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
    "docs/1_setup",
    "docs/2_deploy",
    "docs/3_runbook",
    "docs/4_trouble_shooting",
    "docs/5_assets/analysis",
    "docs/5_assets/client",
    "docs/5_assets/evidence",
    "docs/5_assets/test",
    "external/1_requirements",
    "external/2_specifications",
    "external/3_designs",
    "external/4_glossary",
    "external/99_change_logs",
    "internal/1_sources",
    "internal/2_decisions",
    "internal/3_tasks",
    "internal/4_issues",
    "internal/5_specs",
    "internal/6_designs",
    "internal/7_tests",
];

// schemas/*.json をすべて読み込む
const _rawDefs = readdirSync(SCHEMA_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(readFileSync(join(SCHEMA_DIR, f), "utf-8")));
const _defsByKey = Object.fromEntries(_rawDefs.map(d => [d.key, d]));

// getDocTypes の表示順を固定（ファイルシステムの列挙順に依存しない）
const DOC_TYPE_ORDER = [
    "source", "decision", "task_impl", "task_test", "spec_internal", "spec_external",
    "design_internal", "design_external", "issue", "requirement", "trouble_shooting",
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
    if (numbering === "name") return (name) => `${prefix}-${name}`;
    return null;
}

function buildIdRegex(prefix, numbering) {
    if (numbering === "seq") return new RegExp(`^${prefix}-(\\d{3})`);
    if (numbering === "name") return new RegExp(`^${prefix}-(.+)`);
    return new RegExp(`^${prefix}-`);
}

function buildBodyFn(templateLines) {
    const template = Array.isArray(templateLines) ? templateLines.join("\n") : templateLines;
    return (id, status, linked, date, title) => {
        const linkedStr = linked.filter(l => l).map(l => `- ${l}`).join("\n") || "- ";
        return template
            .replace(/\{\{id\}\}/g, id)
            .replace(/\{\{status\}\}/g, status ?? "")
            .replace(/\{\{date\}\}/g, date)
            .replace(/\{\{title\}\}/g, title)
            .replace(/\{\{linked\}\}/g, linkedStr);
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
