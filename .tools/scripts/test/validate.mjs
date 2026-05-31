/**
 * テスト仕様書 YAML 検証スクリプト
 *
 * 使い方:
 *   node validate.mjs                         … 全プロジェクトを検証
 *   node validate.mjs 001_blueberry_system    … 指定プロジェクトのみ
 *   node validate.mjs <file.yaml>             … 指定ファイルのみ
 *
 * 検証対象（各プロジェクトの external/5_test_specs/）:
 *   preconditions.yaml  → .tools/scripts/test/schemas/preconditions.json で検証
 *   TEST-*.yaml         → .tools/scripts/test/schemas/test_spec.json で検証
 *                         + カスタムチェック（IDの整合性・evidence ルール）
 */
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, basename, dirname, resolve, isAbsolute } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import Ajv from "ajv";
import { WORKSPACE, EXCLUDED_PREFIXES } from "../shared/definitions.mjs";
import { setupLogger } from "../shared/logger.mjs";

// ---------------------------------------------------------------------------
// スキーマ読み込み
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const SCHEMA_DIR = join(dirname(__filename), "schemas");

const SCHEMA_PRECONDITIONS = JSON.parse(
    readFileSync(join(SCHEMA_DIR, "preconditions.json"), "utf-8")
);
const SCHEMA_TEST_SPEC = JSON.parse(
    readFileSync(join(SCHEMA_DIR, "test_spec.json"), "utf-8")
);

const ajv = new Ajv({ allErrors: true });
const validatePreconditions = ajv.compile(SCHEMA_PRECONDITIONS);
const validateTestSpec = ajv.compile(SCHEMA_TEST_SPEC);

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

/** YAMLファイルを読み込む。パースエラーは error として返す */
function loadYaml(filepath) {
    try {
        const text = readFileSync(filepath, "utf-8");
        const data = yaml.load(text, { schema: yaml.JSON_SCHEMA });
        return { data, error: null };
    } catch (e) {
        return { data: null, error: String(e.message ?? e) };
    }
}

/** Ajv のエラーを人間が読める文字列に変換する */
function ajvErrorMsg(err) {
    const path = err.instancePath || "(root)";
    switch (err.keyword) {
        case "required":
            return `必須フィールド '${err.params.missingProperty}' がありません`;
        case "enum":
            return `${path} の値が無効です。有効値: ${err.params.allowedValues.join(", ")}`;
        case "pattern":
            return `${path} の値がパターン '${err.params.pattern}' に一致しません (現在値: ${JSON.stringify(err.data)})`;
        case "type":
            return `${path} の型が不正です。期待: ${err.params.type}`;
        case "minItems":
            return `${path} は ${err.params.limit} 件以上必要です`;
        case "additionalProperties":
            return `${path} に未知のフィールド '${err.params.additionalProperty}' があります`;
        default:
            return `${path} ${err.message}`;
    }
}

/** エラー行を `filepath:1:1: error: msg` 形式で生成する */
function err(filepath, msg) {
    return `${filepath}:1:1: error: ${msg}`;
}

// ---------------------------------------------------------------------------
// preconditions.yaml 検証
// ---------------------------------------------------------------------------
function validatePreconditionsFile(filepath) {
    const errors = [];
    const { data, error } = loadYaml(filepath);

    if (error || data === null || typeof data !== "object") {
        errors.push(err(filepath, `YAMLパースエラー: ${error ?? "空ファイル"}`));
        return errors;
    }

    if (!validatePreconditions(data)) {
        for (const e of validatePreconditions.errors) {
            errors.push(err(filepath, ajvErrorMsg(e)));
        }
    }

    return errors;
}

// ---------------------------------------------------------------------------
// TEST-XXX_*.yaml カスタム検証
// ---------------------------------------------------------------------------

/**
 * ステップIDが spec の id と一致するかをチェックする。
 * 例: spec.id = "TEST-001" → step.id は "TEST-001-..." でなければならない
 */
function checkStepIdConsistency(filepath, data) {
    const errors = [];
    const specId = data.id;          // e.g. "TEST-001"
    if (!specId || !data.cases) return errors;

    for (const tc of data.cases) {
        if (!Array.isArray(tc.steps)) continue;
        for (const step of tc.steps) {
            if (!step.id) continue;
            if (!step.id.startsWith(`${specId}-`)) {
                errors.push(err(filepath,
                    `ステップID '${step.id}' の先頭がこのファイルのID '${specId}' と一致しません`
                ));
            }
        }
    }
    return errors;
}

function checkEvidenceRules(filepath, data) {
    // 証跡項目に対する独自ルールは現在なし
    return [];
}

/**
 * outputDir の存在チェック:
 * - 必須（schema）である前提で、実在するディレクトリかを検証する
 * - 相対パスは YAML ファイル配置ディレクトリ基準で解決する
 */
function checkOutputDirExists(filepath, data) {
    const errors = [];
    const raw = String(data.outputDir ?? "").trim();
    if (!raw) return errors;

    const abs = isAbsolute(raw)
        ? raw
        : resolve(dirname(filepath), raw);

    if (!existsSync(abs)) {
        errors.push(err(filepath, `outputDir が存在しません: ${raw} (解決先: ${abs})`));
        return errors;
    }

    let isDir = false;
    try {
        isDir = statSync(abs).isDirectory();
    } catch {
        isDir = false;
    }

    if (!isDir) {
        errors.push(err(filepath, `outputDir がディレクトリではありません: ${raw} (解決先: ${abs})`));
    }

    return errors;
}

function validateTestSpecFile(filepath) {
    const errors = [];
    const { data, error } = loadYaml(filepath);

    if (error || data === null || typeof data !== "object") {
        errors.push(err(filepath, `YAMLパースエラー: ${error ?? "空ファイル"}`));
        return errors;
    }

    // JSON Schema チェック
    if (!validateTestSpec(data)) {
        for (const e of validateTestSpec.errors) {
            errors.push(err(filepath, ajvErrorMsg(e)));
        }
    }

    // カスタムチェック（スキーマがOKでも実行する）
    errors.push(...checkStepIdConsistency(filepath, data));
    errors.push(...checkEvidenceRules(filepath, data));
    errors.push(...checkOutputDirExists(filepath, data));

    return errors;
}

// ---------------------------------------------------------------------------
// プロジェクト列挙
// ---------------------------------------------------------------------------

function getProjects() {
    return readdirSync(WORKSPACE, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^\d{3}_/.test(d.name))
        .filter(d => !EXCLUDED_PREFIXES.includes(d.name.slice(0, 3)))
        .map(d => join(WORKSPACE, d.name));
}

function getTestSpecDir(projectDir) {
    return join(projectDir, "external", "5_test_specs");
}

function validateProject(projectDir) {
    const errors = [];
    const dir = getTestSpecDir(projectDir);
    if (!existsSync(dir)) return errors;

    const files = readdirSync(dir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));

    for (const file of files.sort()) {
        const filepath = join(dir, file);
        if (file === "preconditions.yaml") {
            errors.push(...validatePreconditionsFile(filepath));
        } else if (/^TEST-\d{3}/.test(file)) {
            errors.push(...validateTestSpecFile(filepath));
        }
        // output/ 配下・その他は対象外
    }

    return errors;
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------
function main() {
    setupLogger("test-validate");
    const args = process.argv.slice(2);
    const allErrors = [];

    if (args.length > 0) {
        const arg = args[0];

        // .yaml/.yml ファイルを直接指定した場合
        if (arg.endsWith(".yaml") || arg.endsWith(".yml")) {
            if (!existsSync(arg)) {
                console.log(`エラー: ファイルが見つかりません: ${arg}`);
                process.exit(1);
            }
            const file = basename(arg);
            if (file === "preconditions.yaml") {
                allErrors.push(...validatePreconditionsFile(arg));
            } else if (/^TEST-\d{3}/.test(file)) {
                allErrors.push(...validateTestSpecFile(arg));
            } else {
                console.log(`スキップ: '${file}' は検証対象外のファイル名です`);
                process.exit(0);
            }
        } else {
            // プロジェクト名指定
            const projects = getProjects();
            const found = projects.find(p => basename(p) === arg || basename(p).endsWith(`_${arg}`));
            if (!found) {
                console.log(`エラー: プロジェクト '${arg}' が見つかりません`);
                process.exit(1);
            }
            allErrors.push(...validateProject(found));
        }
    } else {
        // 全プロジェクト
        const projects = getProjects();
        if (projects.length === 0) {
            console.log("有効なプロジェクトが見つかりません。");
            process.exit(0);
        }
        for (const project of projects) {
            allErrors.push(...validateProject(project));
        }
    }

    if (allErrors.length > 0) {
        for (const e of allErrors) console.log(e);
        process.exit(1);
    } else {
        console.log("すべてのテスト仕様書YAMLが正常です。");
    }
}

main();
