/**
 * 一括ドキュメント作成スクリプト
 *
 * フロー定義（flows.json）に基づき、同一タイトルで複数のドキュメントを一括作成する。
 *
 * 使い方:
 *   node batch.mjs
 *   node batch.mjs 001  # プロジェクト番号を指定
 */
import { readdirSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { getDocTypes, getProjects, findProject } from "./definitions.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HISTORY_FILE = join(__dirname, "..", "logs", "create_history.jsonl");
const FLOWS_FILE = join(__dirname, "..", "flows.json");

function ask(rl, question) {
    return new Promise((r) => rl.question(question, r));
}

function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getNextNumber(dir, regex) {
    if (!existsSync(dir)) return 1;
    let max = 0;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
        const m = f.match(regex);
        if (m?.[1]) { const n = parseInt(m[1], 10); if (n > max) max = n; }
    }
    return max + 1;
}

function getNextSourceNumber(dir, typeCode, dateStr) {
    const prefix = `SRC-${typeCode}-${dateStr}-`;
    if (!existsSync(dir)) return 1;
    return readdirSync(dir).filter((f) => f.startsWith(prefix)).length + 1;
}

function resolveId(tmpl, { sourceType, slug, date }) {
    if (tmpl.numbering === "source") {
        const dateCompact = date.replace(/-/g, "");
        const seq = getNextSourceNumber(tmpl.dir, sourceType, dateCompact);
        return `SRC-${sourceType}-${dateCompact}-${String(seq).padStart(2, "0")}`;
    }
    if (tmpl.numbering === "name") {
        return tmpl.idPattern(slug);
    }
    // seq
    return tmpl.idPattern(getNextNumber(tmpl.dir, tmpl.idRegex));
}

// UNFINISHED があればそれ、なければ defaultStatus を使う
function resolveStatus(tmpl) {
    if (!tmpl.statuses) return "";
    return tmpl.statuses.find(s => s.code === "UNFINISHED")?.code ?? tmpl.defaultStatus;
}

async function main() {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const date = today();

    // flows.json 読み込み
    const { flows } = JSON.parse(readFileSync(FLOWS_FILE, "utf-8"));

    console.log("\n=== 一括ドキュメント作成 ===\n");

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
            if (!Number.isInteger(pi) || pi < 0 || pi >= projects.length) {
                console.log("無効な選択です。"); rl.close(); process.exit(1);
            }
            project = projects[pi];
        }
    }
    console.log();

    // フロー選択
    console.log("フロー:");
    flows.forEach((f, i) => {
        console.log(`  ${i + 1}. ${f.label}`);
        console.log(`       ${f.when}`);
    });
    const fi = parseInt(await ask(rl, "\nフローを選択 (番号): "), 10) - 1;
    if (!Number.isInteger(fi) || fi < 0 || fi >= flows.length) {
        console.log("無効な選択です。"); rl.close(); process.exit(1);
    }
    const flow = flows[fi];

    const DOC_TYPES = getDocTypes(project.dir);
    const typeMap = Object.fromEntries(DOC_TYPES.map(dt => [dt.key, dt]));

    // フローのステップを解決（定義にないキーはスキップ）
    const steps = flow.steps.map(key => typeMap[key]).filter(Boolean);

    console.log(`\n--- ${flow.label} ---`);
    console.log("作成するドキュメント:");
    steps.forEach(dt => console.log(`  • ${dt.label}`));

    // タイトル
    const title = (await ask(rl, "\n共通タイトル: ")).trim();
    if (!title) {
        console.log("タイトルが空です。"); rl.close(); process.exit(1);
    }

    // source が含まれる場合: sourceType を選択
    let sourceType = "IDEA";
    const sourceStep = steps.find(dt => dt.numbering === "source");
    if (sourceStep) {
        console.log("\nSource種別:");
        sourceStep.sourceTypes.forEach((t, i) => console.log(`  ${i + 1}. ${t.code}  ${t.label}`));
        const stIdx = parseInt(await ask(rl, "Source種別を選択 (番号): "), 10) - 1;
        sourceType = sourceStep.sourceTypes[stIdx]?.code ?? "IDEA";
    }

    // name ベース（spec/design）が含まれる場合: スラッグを入力
    let slug = "unnamed";
    const nameStep = steps.find(dt => dt.numbering === "name");
    if (nameStep) {
        slug = (await ask(rl, "\nID用スラッグ (英数字・ハイフン, 例: photo-upload): ")).trim() || "unnamed";
    }

    // 一括作成
    console.log("\n--- 作成開始 ---");
    const created = [];

    for (const tmpl of steps) {
        const id = resolveId(tmpl, { sourceType, slug, date });
        const fileBaseName = `${id}_${title}`;
        const status = resolveStatus(tmpl);

        if (!existsSync(tmpl.dir)) mkdirSync(tmpl.dir, { recursive: true });
        const filePath = join(tmpl.dir, `${fileBaseName}.md`);

        if (existsSync(filePath)) {
            console.log(`  スキップ (既存): ${fileBaseName}.md`);
            continue;
        }

        writeFileSync(filePath, tmpl.body(id, status, [], date, title), "utf-8");
        console.log(`  作成: ${fileBaseName}.md`);
        created.push({ tmpl, id, fileBaseName, status });
    }

    // 履歴記録
    mkdirSync(join(__dirname, "..", "logs"), { recursive: true });
    for (const { tmpl, id, fileBaseName } of created) {
        const record = JSON.stringify({
            datetime: new Date().toISOString(),
            project: project.name,
            flow: flow.key,
            type: tmpl.key,
            label: tmpl.label,
            id,
            title,
            file: `${fileBaseName}.md`,
        });
        appendFileSync(HISTORY_FILE, record + "\n", "utf-8");
    }

    // 関連リンクを各ファイルに追記
    if (created.length > 1) {
        for (const { tmpl, fileBaseName } of created) {
            const filePath = join(tmpl.dir, `${fileBaseName}.md`);
            const others = created
                .filter(c => c.fileBaseName !== fileBaseName)
                .map(c => `- [[${c.fileBaseName}]]`);
            const section = `\n## 関連リンク\n${others.join("\n")}\n`;
            appendFileSync(filePath, section, "utf-8");
        }
    }

    console.log(`\n完了: ${created.length}件 作成しました。`);
    rl.close();
}

main();
