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

function extractFrontmatter(filepath) {
    const text = readFileSync(filepath, "utf-8");
    const match = text.match(/^---\s*\n([\s\S]*?\n)---/);
    if (!match) return { data: null, line: 0 };
    try {
        // Foam wiki links [[...]] → plain string for YAML parsing
        const normalized = match[1].replace(/\[\[([^\]]+)\]\]/g, "$1");
        const data = yaml.load(normalized, { schema: yaml.JSON_SCHEMA });
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

function main() {
    setupLogger("validate");
    const args = process.argv.slice(2);
    const allErrors = [];

    // .md で終わる引数はファイル指定として処理（プロジェクト指定とは別）
    const fileArgs = args.filter(a => a.toLowerCase().endsWith(".md"));
    const projectArg = args.find(a => !a.toLowerCase().endsWith(".md")) ?? null;

    if (fileArgs.length > 0) {
        for (const arg of fileArgs) {
            if (existsSync(arg)) {
                allErrors.push(...validateFile(arg));
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
                    allErrors.push(...validateFile(join(dt.dir, file)));
                }
            }
        }
    }

    if (allErrors.length > 0) {
        for (const err of allErrors) console.log(err);
        process.exit(1);
    } else {
        console.log("すべてのフロントマターが正常です。");
    }
}

main();
