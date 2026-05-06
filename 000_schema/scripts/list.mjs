/**
 * ドキュメント一覧表示スクリプト
 * 各種別のファイル数・ステータス別の内訳・ファイル一覧を表示する。
 *
 * 使い方:
 *   node list.mjs                       … 全プロジェクトを一覧
 *   node list.mjs <プロジェクト名>        … 指定プロジェクトのみ
 *   node list.mjs 001                   … 数字プレフィックスで指定
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { getDocTypes, getProjects, findProject } from "./definitions.mjs";
import { setupLogger } from "./logger.mjs";

function extractFrontmatter(filepath) {
    const text = readFileSync(filepath, "utf-8");
    const match = text.match(/^---\s*\n([\s\S]*?\n)---/);
    if (!match) return null;
    try {
        const data = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
        return typeof data === "object" && data !== null ? data : null;
    } catch {
        return null;
    }
}

function listDir(label, dir) {
    if (!existsSync(dir)) {
        console.log(`\n── ${label} ── (0件)`);
        return 0;
    }

    const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
    console.log(`\n── ${label} ── (${files.length}件)`);

    if (files.length === 0) return 0;

    const statusCount = {};
    const entries = [];

    for (const file of files) {
        const fm = extractFrontmatter(join(dir, file));
        const id = fm?.id || file.replace(/\.md$/, "");
        const displayStatus = fm?.status || "-";
        const updated = fm?.updated_at || "-";

        if (fm?.status) {
            statusCount[fm.status] = (statusCount[fm.status] || 0) + 1;
        }

        entries.push({ id, status: displayStatus, updated, file });
    }

    if (Object.keys(statusCount).length > 0) {
        const summary = Object.entries(statusCount)
            .map(([s, c]) => `${s}: ${c}`)
            .join("  ");
        console.log(`   ${summary}`);
    }

    console.log(`   ${"ID".padEnd(28)} ${"Status".padEnd(16)} ${"Updated".padEnd(12)} File`);
    console.log(`   ${"─".repeat(28)} ${"─".repeat(16)} ${"─".repeat(12)} ${"─".repeat(20)}`);
    for (const e of entries) {
        console.log(`   ${e.id.padEnd(28)} ${e.status.padEnd(16)} ${e.updated.padEnd(12)} ${e.file}`);
    }

    return files.length;
}

function listProject(project) {
    const DOC_TYPES = getDocTypes(project.dir);
    let total = 0;

    console.log(`\n■ プロジェクト: ${project.name}`);

    for (const dt of DOC_TYPES) {
        total += listDir(dt.label, dt.dir);
    }

    return total;
}

function main() {
    setupLogger("list");

    const projectArg = process.argv[2] ?? null;

    console.log("");
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║                    ドキュメント一覧                          ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");

    let targets;
    if (projectArg) {
        const found = findProject(projectArg);
        if (!found) {
            console.log(`\nエラー: プロジェクト '${projectArg}' が見つかりません。`);
            process.exit(1);
        }
        targets = [found];
    } else {
        targets = getProjects();
        if (targets.length === 0) {
            console.log("\n有効なプロジェクトが見つかりません。");
            return;
        }
    }

    let totalFiles = 0;
    for (const project of targets) {
        totalFiles += listProject(project);
    }

    console.log(`\n═══════════════════════════════════════════════════════════════`);
    console.log(`合計: ${totalFiles} 件`);
    console.log("");
}

main();
