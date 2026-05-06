/**
 * 対話式ドキュメント新規作成スクリプト
 *
 * 使い方:
 *   node create.mjs
 */
import { readdirSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { getDocTypes, getProjects, findProject } from "./definitions.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HISTORY_FILE = join(__dirname, "..", "logs", "create_history.jsonl");

// 質問プロンプト
function ask(rl, question) {
    return new Promise((r) => rl.question(question, r));
}

// 今日の日付を YYYY-MM-DD 形式で返す
function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ディレクトリ内のファイルから番号を抽出して次の番号を返す
function getNextNumber(dir, regex) {
    if (!existsSync(dir)) return 1;
    let max = 0;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
        const m = f.match(regex);
        if (m?.[1]) { const n = parseInt(m[1], 10); if (n > max) max = n; }
    }
    return max + 1;
}

// source タイプのファイルは日付ごとに連番を振る
function getNextSourceNumber(dir, typeCode, dateStr) {
    const prefix = `SRC-${typeCode}-${dateStr}-`;
    if (!existsSync(dir)) return 1;
    return readdirSync(dir).filter((f) => f.startsWith(prefix)).length + 1;
}

async function main() {
    // 対話式プロンプトで必要な情報を収集して、テンプレートに基づいてファイルを生成する
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const date = today();

    console.log("\n=== ドキュメント新規作成 ===\n");

    // プロジェクト選択
    const projectArgRaw = process.argv[2] ?? null;
    let project = findProject(projectArgRaw);
    if (!project) {
        const projects = getProjects();
        if (projects.length === 0) {
            console.log("エラー: 有効なプロジェクトが見つかりません。");
            rl.close();
            process.exit(1);
        }
        if (projects.length === 1) {
            project = projects[0];
            console.log(`プロジェクト: ${project.name}`);
        } else {
            console.log("プロジェクト:");
            projects.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}`));
            const pi = parseInt(await ask(rl, "\nプロジェクトを選択 (番号): "), 10) - 1;
            if (pi < 0 || pi >= projects.length) {
                console.log("無効な選択です。");
                rl.close();
                process.exit(1);
            }
            project = projects[pi];
        }
    }
    console.log();

    const DOC_TYPES = getDocTypes(project.dir);
    DOC_TYPES.forEach((dt, i) => console.log(`  ${i + 1}. ${dt.label}${dt.prefix ? ` (${dt.prefix})` : ""}`));
    console.log();

    const typeInput = await ask(rl, "種別を選択 (番号): ");
    const idx = parseInt(typeInput, 10) - 1;
    if (idx < 0 || idx >= DOC_TYPES.length) {
        console.log("無効な選択です。");
        rl.close();
        process.exit(1);
    }

    // テンプレート取得
    const tmpl = DOC_TYPES[idx];
    let id, fileBaseName;

    // ID 決定
    if (tmpl.numbering === "source") {
        console.log("\n種別:");
        tmpl.sourceTypes.forEach((t, i) => console.log(`  ${i + 1}. ${t.code}  ${t.label}`));
        const stInput = await ask(rl, "種別を選択 (番号): ");
        const sourceType = tmpl.sourceTypes[parseInt(stInput, 10) - 1]?.code || "DEV";
        const dateCompact = date.replace(/-/g, "");
        const seq = getNextSourceNumber(tmpl.dir, sourceType, dateCompact);
        id = `SRC-${sourceType}-${dateCompact}-${String(seq).padStart(2, "0")}`;
        fileBaseName = id;
    } else if (tmpl.numbering === "name") {
        const name = await ask(rl, `${tmpl.prefix}名 (例: auth): `);
        id = tmpl.idPattern(name || "unnamed");
        fileBaseName = id;
    } else {
        const nextNum = getNextNumber(tmpl.dir, tmpl.idRegex);
        id = tmpl.idPattern(nextNum);
        fileBaseName = id;
        console.log(`\n次の番号: ${id}`);
    }

    // タイトル → ファイル名にも使う
    const title = await ask(rl, "タイトル: ");
    if (title.trim()) fileBaseName = `${fileBaseName}_${title.trim()}`;

    // ステータス
    let status = "";
    if (tmpl.statuses) {
        console.log("\nステータス:");
        tmpl.statuses.forEach((s, i) => {
            console.log(`  ${i + 1}. ${s.code}  ${s.label}${s.code === tmpl.defaultStatus ? " (デフォルト)" : ""}`);
        });
        const si = parseInt(await ask(rl, `ステータス (番号, Enter=${tmpl.defaultStatus}): `), 10) - 1;
        status = tmpl.statuses[si]?.code || tmpl.defaultStatus;
    }

    // ファイル生成
    if (!existsSync(tmpl.dir)) mkdirSync(tmpl.dir, { recursive: true });
    const filePath = join(tmpl.dir, `${fileBaseName}.md`);

    if (existsSync(filePath)) {
        console.log(`\nエラー: ${filePath} は既に存在します。`);
        rl.close();
        process.exit(1);
    }

    writeFileSync(filePath, tmpl.body(id, status, [], date, title.trim() || id), "utf-8");
    console.log(`\n作成完了: ${filePath}`);

    // 作成履歴を蓄積
    mkdirSync(join(__dirname, "..", "logs"), { recursive: true });
    const record = JSON.stringify({
        datetime: new Date().toISOString(),
        project: project.name,
        type: tmpl.key,
        label: tmpl.label,
        id,
        title: title.trim() || id,
        file: `${fileBaseName}.md`,
    });
    appendFileSync(HISTORY_FILE, record + "\n", "utf-8");

    rl.close();
}

main();
