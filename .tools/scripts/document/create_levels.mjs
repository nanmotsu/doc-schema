/**
 * Lv1/Lv2/Lv3 生成スクリプト
 *
 * 使い方:
 *   node create_levels.mjs
 *   node create_levels.mjs <project>
 */
import { readdirSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { getDocTypes, getProjects, findProject, toWikiLinkRef } from "../shared/definitions.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HISTORY_FILE = join(__dirname, "..", "..", "logs", "create_history.jsonl");

function ask(rl, question) {
    return new Promise((r) => rl.question(question, r));
}

function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getCurrentYear(dateStr) {
    return (dateStr || today()).slice(0, 4);
}

function getNextNumber(dir, regex) {
    if (!existsSync(dir)) return 1;
    let max = 0;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
        const m = f.match(regex);
        if (m?.[1]) {
            const n = parseInt(m[1], 10);
            if (n > max) max = n;
        }
    }
    return max + 1;
}

function getNextYearNumber(dir, regex, year) {
    if (!existsSync(dir)) return 1;
    let max = 0;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
        const m = f.match(regex);
        if (!m?.[1] || !m?.[2]) continue;
        if (m[1] !== year) continue;
        const n = parseInt(m[2], 10);
        if (n > max) max = n;
    }
    return max + 1;
}

function resolveId(tmpl, date) {
    if (tmpl.numbering === "year_seq") {
        const year = getCurrentYear(date);
        const nextNum = getNextYearNumber(tmpl.dir, tmpl.idRegex, year);
        return tmpl.idPattern(nextNum, year);
    }
    if (tmpl.numbering === "seq") {
        const nextNum = getNextNumber(tmpl.dir, tmpl.idRegex);
        return tmpl.idPattern(nextNum);
    }
    const dateCompact = date.replace(/-/g, "");
    return tmpl.idPattern(`${dateCompact}-001`);
}

function parseCsv(input) {
    return String(input || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
}

function resolveAutoLinks(target, docs) {
    const links = {};
    for (const field of target.tmpl.linkFields ?? []) {
        const matches = docs
            .filter((doc) => doc.id !== target.id)
            .map((doc) => doc.fileBaseName)
            .filter((name) => field.pattern?.test(name.split("_")[0] ?? name));
        if (matches.length > 0) {
            links[field.key] = matches.map((name) => toWikiLinkRef(name)).filter(Boolean);
        }
    }
    return links;
}

function writeDoc({ tmpl, id, title, status, date, dirOverride = null, meta = {} }) {
    const targetDir = dirOverride ?? tmpl.dir;
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

    const fileBaseName = `${id}_${title}`;
    const filePath = join(targetDir, `${fileBaseName}.md`);
    if (existsSync(filePath)) {
        throw new Error(`既存ファイルです: ${filePath}`);
    }

    writeFileSync(filePath, tmpl.body(id, status, [], date, title, meta), "utf-8");
    return { filePath, fileBaseName };
}

function logRecord(projectName, flow, tmpl, id, title, fileBaseName) {
    mkdirSync(join(__dirname, "..", "..", "logs"), { recursive: true });
    const record = JSON.stringify({
        datetime: new Date().toISOString(),
        project: projectName,
        flow,
        type: tmpl.key,
        label: tmpl.label,
        id,
        title,
        file: `${fileBaseName}.md`,
    });
    appendFileSync(HISTORY_FILE, record + "\n", "utf-8");
}

async function pickProject(rl, projectArgRaw) {
    let project = findProject(projectArgRaw);
    if (project) return project;

    const projects = getProjects();
    if (projects.length === 0) {
        throw new Error("有効なプロジェクトが見つかりません。");
    }
    if (projects.length === 1) {
        return projects[0];
    }

    console.log("プロジェクト:");
    projects.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}`));
    const pi = parseInt(await ask(rl, "\nプロジェクトを選択 (番号): "), 10) - 1;
    if (pi < 0 || pi >= projects.length) {
        throw new Error("無効な選択です。");
    }
    return projects[pi];
}

async function main() {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const date = today();

    try {
        console.log("\n=== Lv1/Lv2/Lv3 生成 ===\n");

        const project = await pickProject(rl, process.argv[2] ?? null);
        const title = (await ask(rl, "共通タイトル: ")).trim();
        if (!title) throw new Error("タイトルが空です。");
        const owner = (await ask(rl, "共通owner (Enter=TBD): ")).trim() || "TBD";
        const tags = parseCsv(await ask(rl, "共通tags (カンマ区切り, Enter=なし): "));

        console.log("\nレベル:");
        console.log("  1. Lv1 (Issue + Ticket + Test)");
        console.log("  2. Lv2 (Issue + Decision + Change + Spec + Test)");
        console.log("  3. Lv3 (Issue + Decision + MOD folder + REQ/SPEC/TEST)");
        const level = parseInt(await ask(rl, "レベルを選択 (1-3): "), 10);
        if (![1, 2, 3].includes(level)) throw new Error("無効なレベルです。");

        const issueChoice = (await ask(rl, "issueを作成する? (Y/n): ")).trim().toLowerCase();
        const includeIssue = issueChoice !== "n" && issueChoice !== "no";

        const typeMap = Object.fromEntries(getDocTypes(project.dir).map((d) => [d.key, d]));

        const planByLevel = {
            1: ["issue", "ticket_level1", "test_case"],
            2: ["issue", "decision", "change_level2", "specification", "test_case"],
            3: ["issue", "decision", "mod_project"],
        };

        const resolvedPlan = includeIssue ? planByLevel[level] : planByLevel[level].filter((key) => key !== "issue");

        const created = [];
        for (const key of resolvedPlan) {
            const tmpl = typeMap[key];
            if (!tmpl) continue;
            const id = resolveId(tmpl, date);
            const status = tmpl.defaultStatus || "draft";
            const fileBaseName = `${id}_${title}`;
            const filePath = join(tmpl.dir, `${fileBaseName}.md`);
            if (existsSync(filePath)) {
                throw new Error(`既存ファイルです: ${filePath}`);
            }
            created.push({ key, id, filePath, fileBaseName, tmpl, status, date, dirOverride: null });
        }

        if (level === 3) {
            const mod = created.find((c) => c.key === "mod_project");
            if (!mod) throw new Error("Lv3 の MOD 作成に失敗しました。");

            const modFolder = join(typeMap.mod_project.dir, mod.id);
            mkdirSync(modFolder, { recursive: true });

            writeFileSync(join(modFolder, "README.md"), `# ${mod.id}\n`, "utf-8");
            writeFileSync(join(modFolder, "impact_analysis.md"), "# Impact Analysis\n", "utf-8");

            const lv3Children = ["requirement", "specification", "test_case"];
            for (const key of lv3Children) {
                const tmpl = typeMap[key];
                if (!tmpl) continue;
                const id = resolveId(tmpl, date);
                const status = tmpl.defaultStatus || "draft";
                const fileBaseName = `${id}_${title}`;
                const filePath = join(modFolder, `${fileBaseName}.md`);
                if (existsSync(filePath)) {
                    throw new Error(`既存ファイルです: ${filePath}`);
                }
                created.push({ key, id, filePath, fileBaseName, tmpl, status, date, dirOverride: modFolder });
            }

            console.log(`\nLv3 案件フォルダ作成: ${modFolder}`);
        }

        for (const doc of created) {
            writeDoc({
                tmpl: doc.tmpl,
                id: doc.id,
                title,
                status: doc.status,
                date: doc.date,
                dirOverride: doc.dirOverride,
                meta: { owner, tags, links: resolveAutoLinks(doc, created) },
            });
            logRecord(project.name, level === 3 ? "level3" : `level${level}`, doc.tmpl, doc.id, title, doc.fileBaseName);
        }

        console.log("\n作成ファイル:");
        created.forEach((c) => console.log(`  - ${c.filePath}`));
        console.log(`\n完了: ${created.length} 件`);
        rl.close();
    } catch (e) {
        console.log(`\nエラー: ${e.message}`);
        rl.close();
        process.exit(1);
    }
}

main();
