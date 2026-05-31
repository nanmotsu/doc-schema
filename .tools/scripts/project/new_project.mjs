/**
 * 新規プロジェクト作成スクリプト
 *
 * ワークスペース直下に連番フォルダ（例: 002_新プロジェクト）を作成し、
 * 999_フォルダ構成について/フォルダ構成 と同じ構造を生成する
 *
 * 使い方:
 *   node new_project.mjs
 */
import { readdirSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { WORKSPACE, EXCLUDED_PREFIXES, PROJECT_FOLDER_STRUCTURE, PROJECT_BOOTSTRAP_FILES } from "../shared/definitions.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function ask(rl, question) {
    return new Promise((r) => rl.question(question, r));
}

// ワークスペース直下のプロジェクトフォルダから最大連番を取得
function getNextProjectNumber() {
    const entries = readdirSync(WORKSPACE, { withFileTypes: true });
    let max = 0;
    for (const e of entries) {
        if (!e.isDirectory()) continue;
        const m = e.name.match(/^(\d{3})_/);
        if (!m) continue;
        if (EXCLUDED_PREFIXES.includes(m[1])) continue;
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
    }
    return max + 1;
}

async function main() {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    console.log("\n=== 新規プロジェクト作成 ===\n");

    const nextNum = getNextProjectNumber();
    const numStr = String(nextNum).padStart(3, "0");
    console.log(`次の番号: ${numStr}`);

    const name = (await ask(rl, "プロジェクト名（日本語可）: ")).trim();
    rl.close();

    if (!name) {
        console.log("エラー: プロジェクト名が空です。");
        process.exit(1);
    }

    const folderName = `${numStr}_${name}`;
    const projectDir = join(WORKSPACE, folderName);

    if (existsSync(projectDir)) {
        console.log(`エラー: フォルダ ${folderName} はすでに存在します。`);
        process.exit(1);
    }

    // フォルダ作成
    for (const rel of PROJECT_FOLDER_STRUCTURE) {
        mkdirSync(join(projectDir, rel), { recursive: true });
    }

    // 各フォルダに .gitkeep を配置
    for (const rel of PROJECT_FOLDER_STRUCTURE) {
        writeFileSync(join(projectDir, rel, ".gitkeep"), "");
    }

    // 主要ファイルを初期配置
    for (const file of PROJECT_BOOTSTRAP_FILES) {
        writeFileSync(join(projectDir, file.path), file.content, "utf-8");
    }

    console.log(`\n作成完了: ${folderName}`);
    console.log(`場所: ${projectDir}`);
    console.log(`\nフォルダ構成:`);
    for (const rel of PROJECT_FOLDER_STRUCTURE) {
        console.log(`  ${folderName}/${rel}`);
    }
    console.log("\n初期ファイル:");
    for (const file of PROJECT_BOOTSTRAP_FILES) {
        console.log(`  ${folderName}/${file.path}`);
    }
}

main().catch(e => { console.error(e); process.exit(1); });
