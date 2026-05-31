/**
 * フロントマター検証スクリプト
 * VS Codeの問題パネルで認識できる形式でエラーを出力する。
 *
 * 使い方:
 *   node validate.mjs                   … 全プロジェクトを検証
 *   node validate.mjs <プロジェクト名>    … 指定プロジェクトのみ
 *   node validate.mjs <file>            … 指定ファイルのみ
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { basename, join } from "path";
import yaml from "js-yaml";
import Ajv from "ajv";
import { SCHEMA_MAP, getSchema, getDocTypes, getProjects, findProject } from "../shared/definitions.mjs";
import { setupLogger } from "../shared/logger.mjs";

const ajv = new Ajv({ allErrors: true });

const PHASE_STRICT_LINK_RULES = {
    issue: "decisions",
    decision: "requirements",
    requirement: "specifications",
    specification: "tests",
    ticket_level1: "tests",
    change_level2: "specifications",
    mod_project: "requirements",
};

function extractFrontmatter(filepath) {
    const text = readFileSync(filepath, "utf-8");
    const match = text.match(/^---\s*\n([\s\S]*?\n)---/);
    if (!match) return { data: null, line: 0 };
    try {
        const data = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
        return { data: typeof data === "object" && data !== null ? data : null, line: 2 };
    } catch {
        return { data: null, line: 2 };
    }
}

function findSchemaKey(filename) {
    const idPart = filename.replace(/\.[^.]+$/, "").split("_")[0];
    for (const { pattern, key } of SCHEMA_MAP) {
        if (pattern.test(idPart)) return key;
    }
    return null;
}

function validateFile(filepath) {
    const errors = [];
    const key = findSchemaKey(basename(filepath));
    const keySchema = getSchema(key);
    if (!key || !keySchema) return errors;

    const { data, line } = extractFrontmatter(filepath);
    if (data === null) {
        errors.push(`${filepath}:${line}:1: error: フロントマターがありません、または不正なYAMLです`);
        return errors;
    }

    const schema = { type: "object", ...keySchema };
    const validate = ajv.compile(schema);
    if (!validate(data)) {
        for (const err of validate.errors) {
            const field = err.instancePath || "(root)";
            let msg;
            switch (err.keyword) {
                case "required":
                    msg = `必須フィールド '${err.params.missingProperty}' がありません`;
                    break;
                case "enum":
                    msg = `${field} の値が無効です。有効値: ${err.params.allowedValues.join(", ")}`;
                    break;
                case "pattern":
                    msg = `${field} の値がパターン ${err.params.pattern} に一致しません`;
                    break;
                case "type":
                    msg = `${field} の型が不正です。期待: ${err.params.type}`;
                    break;
                default:
                    msg = `${field} ${err.message}`;
            }
            errors.push(`${filepath}:${line}:1: error: ${msg}`);
        }
    }
    return errors;
}

function hasFilledLinkList(value) {
    if (!Array.isArray(value)) return false;
    return value.some((v) => typeof v === "string" && v.trim().length > 0);
}

function validatePhaseStrict(filepath, schemaKey, frontmatter, line) {
    const errors = [];
    const requiredField = PHASE_STRICT_LINK_RULES[schemaKey];
    if (!requiredField) return errors;

    if (!hasFilledLinkList(frontmatter?.[requiredField])) {
        errors.push(`${filepath}:${line}:1: error: strict-phase: '${requiredField}' に1件以上のリンクが必要です`);
    }
    return errors;
}

function main() {
    setupLogger("validate");
    const rawArgs = process.argv.slice(2);
    const strictPhase = rawArgs.includes("--strict-phase") || rawArgs.includes("--strict");
    const args = rawArgs.filter(a => a !== "--strict-phase" && a !== "--strict");
    const allErrors = [];

    // .md で終わる引数はファイル指定として処理（プロジェクト指定とは別）
    const fileArgs = args.filter(a => a.toLowerCase().endsWith(".md"));
    const projectArg = args.find(a => !a.toLowerCase().endsWith(".md")) ?? null;

    if (fileArgs.length > 0) {
        for (const arg of fileArgs) {
            if (existsSync(arg)) {
                allErrors.push(...validateFile(arg));
                if (strictPhase) {
                    const key = findSchemaKey(basename(arg));
                    const { data, line } = extractFrontmatter(arg);
                    if (data !== null) {
                        allErrors.push(...validatePhaseStrict(arg, key, data, line));
                    }
                }
            }
        }
    } else {
        let targets;
        if (projectArg) {
            const found = findProject(projectArg);
            if (!found) {
                console.log(`エラー: プロジェクト '${projectArg}' が見つかりません。`);
                process.exit(1);
            }
            targets = [found];
        } else {
            targets = getProjects();
            if (targets.length === 0) {
                console.log("有効なプロジェクトが見つかりません。");
                process.exit(0);
            }
        }

        for (const project of targets) {
            for (const dt of getDocTypes(project.dir)) {
                if (!existsSync(dt.dir)) continue;
                for (const file of readdirSync(dt.dir).filter((f) => f.endsWith(".md")).sort()) {
                    const fullPath = join(dt.dir, file);
                    allErrors.push(...validateFile(fullPath));
                    if (strictPhase) {
                        const key = findSchemaKey(file);
                        const { data, line } = extractFrontmatter(fullPath);
                        if (data !== null) {
                            allErrors.push(...validatePhaseStrict(fullPath, key, data, line));
                        }
                    }
                }
            }
        }
    }

    if (allErrors.length > 0) {
        for (const err of allErrors) console.log(err);
        process.exit(1);
    } else {
        if (strictPhase) {
            console.log("すべてのフロントマターが正常です。（strict-phase 有効）");
        } else {
            console.log("すべてのフロントマターが正常です。");
        }
    }
}

main();
