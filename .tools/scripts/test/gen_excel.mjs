/**
 * gen_excel.mjs
 * YAML テスト仕様書 → Excel 変換ツール
 *
 * 使い方:
 *   node gen_excel.mjs <5_test_specs ディレクトリ>
 *   例: node gen_excel.mjs ../../../001_blueberry_system/external/5_test_specs
 *
 * 出力: <ディレクトリ>/output/テスト仕様書_yyyyMMddHHmmss.xlsx（シート構成）
 *   Sheet1 : ①共通前提条件  — preconditions.yaml の内容（全仕様共通・1枚固定）
 *   Sheet2+ : 各テスト仕様  — TEST-*.yaml ごとに 1 シート
 *               └ 上部: その仕様の前提条件 + 事前データ
 *               └ 下部: テストケース（ステップ一覧）
 *
 * 列表示切り替え:
 *   000_schema/test/excel_columns.json の enabled: false で列を非表示にできる
 */

import { readFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { resolve, join, dirname, extname, isAbsolute } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const _require = createRequire(import.meta.url);
const yaml = _require("js-yaml");
const ExcelJS = _require("exceljs");

// ── 列定義をスキーマから読み込む ──────────────────────────────
const COL_CONFIG_PATH = resolve(__dirname, "..", "..", "..", "000_schema", "test", "excel_columns.json");
const colConfig = JSON.parse(readFileSync(COL_CONFIG_PATH, "utf-8"));
const ACTIVE_COLS = colConfig.columns.filter(c => c.enabled !== false);

// ── 定数 ──────────────────────────────────────────────────────
const RESULT_LABEL = { pass: "✓ 合格", fail: "✗ 不合格", pending: "― 保留" };
const STEP_STATUS_LABEL = { pass: "合格", fail: "不合格", pending: "保留", not_run: "未実施" };
const ENV_LABEL_MAP = { os: "OS", browser: "ブラウザ", server: "サーバー", db: "DB" };

function shortSpecLabel(spec) {
    return String(spec?.id ?? "spec");
}

function safeSheetName(baseName) {
    const cleaned = String(baseName ?? "")
        .replace(/[\\/?*\[\]:]/g, " ")
        .trim();
    return cleaned.length > 31 ? cleaned.slice(0, 31) : (cleaned || "Sheet");
}

function screenshotPaths(step) {
    const raw = step?.evidence?.screenshot;
    if (Array.isArray(raw)) return raw.map(v => String(v ?? "").trim()).filter(Boolean);
    if (typeof raw === "string" && raw.trim()) return [raw.trim()];
    return [];
}

function evidenceMemo(step) {
    return String(step?.evidence?.memo ?? "");
}

function resolveImagePath(specDir, specFile, spec, shot) {
    const text = String(shot ?? "").trim();
    if (!text) return "";
    if (/^(https?:|data:|file:)/i.test(text)) return "";
    if (isAbsolute(text)) return text;

    const yamlDir = dirname(join(specDir, specFile));
    const outputDir = String(spec?.outputDir ?? "").trim();
    if (outputDir) return resolve(yamlDir, outputDir, text);
    return resolve(yamlDir, text);
}

function imageExt(absPath) {
    const ext = extname(String(absPath ?? "")).toLowerCase();
    if (ext === ".png") return "png";
    if (ext === ".jpg" || ext === ".jpeg") return "jpeg";
    if (ext === ".gif") return "gif";
    return "png";
}

function caseTitleText(tc) {
    const id = String(tc?.id ?? "").trim();
    const title = String(tc?.title ?? "").trim();
    return `${id}${title ? " " + title : ""}`.trim();
}

function resolveStepStatus(step) {
    const detail = step?.result_detail ?? step?.resulet_detail;
    if (detail && typeof detail === "object") {
        if (["pass", "fail", "pending", "not_run"].includes(detail.status)) return detail.status;
        if (typeof detail.passed === "boolean") return detail.passed ? "pass" : "fail";
    }
    if (typeof step?.passed === "boolean") return step.passed ? "pass" : "fail";
    return "not_run";
}

/** key → セル値 のマッピング */
function cellValue(key, spec, tc, step) {
    const resultDetail = step?.result_detail ?? step?.resulet_detail;
    const statusFromDetail = resolveStepStatus(step);
    const statusLabel = STEP_STATUS_LABEL[statusFromDetail] ?? String(statusFromDetail ?? "");
    const resultDetailText = typeof resultDetail === "string"
        ? resultDetail
        : (resultDetail && typeof resultDetail === "object"
            ? `${statusLabel}${resultDetail.remark ? " / " + resultDetail.remark : ""}`
            : "");

    switch (key) {
        case "testId": return spec.id;
        case "caseId": return tc.id;
        case "caseTitle": return tc.title;
        case "stepId": return step.id;
        case "subtitle": return step.subtitle ?? "";
        case "precond": return step.precondition ?? "—";
        case "action": return step.action;
        case "expected": return step.expected;
        case "evShot": return step.evidence?.screenshot ?? "—";
        case "testedAt": return tc.tested_at ?? "";
        case "testedBy": return tc.tested_by ?? "";
        case "result": return statusLabel;
        case "resultDetail": return resultDetailText;
        default: return "";
    }
}

// ── スタイルヘルパー ──────────────────────────────────────────
function styleHeader(row, bgColor = "2C3E50") {
    row.eachCell(cell => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + bgColor } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = borders();
    });
    row.height = 22;
}

function styleSection(row, bgColor = "2980B9") {
    row.eachCell(cell => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + bgColor } };
        cell.alignment = { vertical: "middle" };
    });
    row.height = 20;
}

function styleData(row) {
    row.eachCell({ includeEmpty: true }, cell => {
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = borders();
    });
    row.height = 18;
}

function borders() {
    const s = { style: "thin", color: { argb: "FFD0D0D0" } };
    return { top: s, left: s, bottom: s, right: s };
}

// ── Sheet1: 共通前提条件（preconditions.yaml） ───────────────
function buildCommonSheet(sheet, pre) {
    sheet.name = "①共通前提条件";

    if (pre.preconditions?.length) {
        const h = sheet.addRow(["前提条件"]);
        styleSection(h, "2C3E50");
        sheet.mergeCells(h.number, 1, h.number, 2);
        for (const cond of pre.preconditions) {
            const r = sheet.addRow(["・" + cond]);
            sheet.mergeCells(r.number, 1, r.number, 2);
            styleData(r);
        }
        sheet.addRow([]);
    }

    if (pre.environment) {
        const h = sheet.addRow(["実行環境"]);
        styleSection(h, "2C3E50");
        sheet.mergeCells(h.number, 1, h.number, 2);
        for (const [k, v] of Object.entries(pre.environment)) {
            const r = sheet.addRow([ENV_LABEL_MAP[k] ?? k, v]);
            styleData(r);
        }
        sheet.addRow([]);
    }

    if (pre.test_data?.length) {
        const h = sheet.addRow(["共通事前データ"]);
        styleSection(h, "2C3E50");
        sheet.mergeCells(h.number, 1, h.number, 4);
        sheet.addRow([]);
        appendTestDataTables(sheet, pre.test_data);
    }

    sheet.getColumn(1).width = 28;
    sheet.getColumn(2).width = 40;
}

// ── テスト仕様シート（前提 + 事前データ + ステップを1枚に） ──
function buildSpecSheet(sheet, spec) {
    const rawName = `${spec.id} ${spec.title ?? ""}`.trim();
    sheet.name = safeSheetName(rawName);
    const stepNoById = new Map();

    // 上部: この仕様の前提条件
    if (spec.preconditions?.length) {
        const h = sheet.addRow(["前提条件"]);
        styleSection(h, "117A65");
        sheet.mergeCells(h.number, 1, h.number, 2);
        for (const cond of spec.preconditions) {
            const r = sheet.addRow(["・" + cond]);
            sheet.mergeCells(r.number, 1, r.number, 2);
            styleData(r);
        }
        sheet.addRow([]);
    }

    // 上部: 事前データ
    if (spec.test_data?.length) {
        const h = sheet.addRow(["事前データ"]);
        styleSection(h, "117A65");
        sheet.mergeCells(h.number, 1, h.number, 4);
        sheet.addRow([]);
        appendTestDataTables(sheet, spec.test_data);
    }

    if (spec.preconditions?.length || spec.test_data?.length) {
        sheet.addRow([]);
    }

    // 下部: テストケース（ステップ一覧）— 左端に No 列を追加
    const TABLE_COLS = [{ key: "__no", header: "No", width: 8 }, ...ACTIVE_COLS];
    TABLE_COLS.forEach((c, i) => { sheet.getColumn(i + 1).width = c.width; });

    const hRow = sheet.addRow(TABLE_COLS.map(c => c.header));
    styleHeader(hRow, "1A5276");

    // 結果列・実施日列のインデックス（1-based）
    const resultColIdx = TABLE_COLS.findIndex(c => c.key === "result") + 1;
    const testedAtIdx = TABLE_COLS.findIndex(c => c.key === "testedAt") + 1;
    let stepNo = 0;

    for (const tc of (spec.cases ?? [])) {
        const sep = sheet.addRow([caseTitleText(tc)]);
        sheet.mergeCells(sep.number, 1, sep.number, Math.max(1, TABLE_COLS.length));
        styleSection(sep, "0B4F6C");

        for (const step of (tc.steps ?? [])) {
            stepNo += 1;
            const stepId = String(step?.id ?? "").trim();
            if (stepId) stepNoById.set(stepId, stepNo);

            const row = sheet.addRow(TABLE_COLS.map(c => c.key === "__no" ? stepNo : cellValue(c.key, spec, tc, step)));
            styleData(row);

            // 結果列に色付け（step単位）
            if (resultColIdx > 0) {
                const cell = row.getCell(resultColIdx);
                const status = resolveStepStatus(step);
                if (status === "pass") { cell.font = { color: { argb: "FF1E8449" }, bold: true }; }
                else if (status === "fail") { cell.font = { color: { argb: "FFC0392B" }, bold: true }; }
                else if (status === "pending") { cell.font = { color: { argb: "FF7D6608" }, bold: true }; }
                else if (status === "not_run") { cell.font = { color: { argb: "FF6B7280" }, bold: true }; }
            }

            // 実施日列を日付型に（文字列 YYYY-MM-DD が入っている場合）
            if (testedAtIdx > 0 && tc.tested_at) {
                const d = new Date(tc.tested_at);
                if (!isNaN(d)) {
                    const cell = row.getCell(testedAtIdx);
                    cell.value = d;
                    cell.numFmt = "yyyy/mm/dd";
                }
            }
        }
    }

    // 列固定は行わない（Excel の行固定は見出し行単位でしかできないため。必要ならユーザー側で設定してもらう）
    //sheet.views = [{ state: "frozen", ySplit: hRow.number }];

    return stepNoById;
}

function buildEvidenceSheet(wb, spec, specFile, specDir, stepNoById = new Map()) {
    const sheet = wb.addWorksheet();
    const evidenceName = safeSheetName(`証跡_${shortSpecLabel(spec)}`);
    sheet.name = evidenceName;
    sheet.pageSetup = {
        paperSize: 9, // A4
        orientation: "portrait",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: {
            left: 0.4,
            right: 0.4,
            top: 0.5,
            bottom: 0.5,
            header: 0.3,
            footer: 0.3,
        },
    };

    sheet.getColumn(1).width = 80;

    const title = sheet.addRow([`${spec.id} ${spec.title ?? ""} / 証跡`]);
    styleSection(title, "1A5276");
    sheet.mergeCells(title.number, 1, title.number, 1);
    sheet.addRow([]);

    const imageWidth = 480;
    const imageHeight = 270;

    for (const tc of (spec.cases ?? [])) {
        const tcRow = sheet.addRow([caseTitleText(tc)]);
        styleSection(tcRow, "117A65");

        for (const step of (tc.steps ?? [])) {
            const stepId = String(step?.id ?? "").trim();
            const stepNo = stepNoById.get(stepId);
            const noRow = sheet.addRow([stepNo ? `No.${stepNo}` : "No.-"]);
            noRow.font = { bold: true, color: { argb: "FF0F172A" } };
            noRow.height = 18;

            const memo = evidenceMemo(step);
            if (memo) {
                const memoRow = sheet.addRow([memo]);
                memoRow.height = Math.max(22, memo.split(/\r?\n/).length * 16);
                memoRow.eachCell(cell => {
                    cell.alignment = { vertical: "top", wrapText: true };
                    cell.font = { color: { argb: "FF1F2937" } };
                    cell.border = borders();
                });
            }

            const shots = screenshotPaths(step);
            if (shots.length === 0) {
                sheet.addRow([]);
                continue;
            }

            for (const shot of shots) {
                const abs = resolveImagePath(specDir, specFile, spec, shot);
                if (!abs || !existsSync(abs)) {
                    const miss = sheet.addRow([`（画像未検出）${shot}`]);
                    miss.font = { color: { argb: "FFC0392B" } };
                    miss.height = 18;
                    continue;
                }

                // 画像を確実に収めるため、先に専用セル領域を確保してから配置する
                const blockStart = sheet.rowCount + 1;
                const blockRows = 20;
                for (let i = 0; i < blockRows; i++) {
                    const r = sheet.addRow([""]);
                    r.height = 14;
                }
                sheet.mergeCells(blockStart, 1, blockStart + blockRows - 1, 1);

                const img = wb.addImage({
                    buffer: readFileSync(abs),
                    extension: imageExt(abs),
                });
                sheet.addImage(img, {
                    tl: { col: 0.2, row: blockStart - 1 + 0.2 },
                    ext: { width: imageWidth, height: imageHeight },
                    editAs: "oneCell",
                });
                sheet.addRow([]);
            }
        }

        sheet.addRow([]);
    }
}

// ── 共通: test_data テーブル群をシートに追記 ─────────────────
function appendTestDataTables(sheet, testDataArr) {
    for (const td of (testDataArr ?? [])) {
        const titleText = td.description ? `${td.label}（${td.description}）` : td.label;
        const colCount = td.columns?.length ?? 1;

        const tRow = sheet.addRow([titleText]);
        sheet.mergeCells(tRow.number, 1, tRow.number, colCount);
        styleSection(tRow, "2980B9");

        const hRow = sheet.addRow(td.columns ?? []);
        styleHeader(hRow, "5D6D7E");

        for (const row of (td.rows ?? [])) {
            const dRow = sheet.addRow(row);
            styleData(dRow);
        }
        sheet.addRow([]);
    }
}

// ── メイン処理 ────────────────────────────────────────────────
const specDir = resolve(process.argv[2] ?? ".");
if (!existsSync(specDir)) {
    console.error(`ディレクトリが見つかりません: ${specDir}`);
    process.exit(1);
}

const outputDir = join(specDir, "output");
mkdirSync(outputDir, { recursive: true });

const prePath = join(specDir, "preconditions.yaml");
const pre = existsSync(prePath) ? yaml.load(readFileSync(prePath, "utf-8")) : {};

const yamlFiles = readdirSync(specDir)
    .filter(f => /^TEST-.*\.yaml$/i.test(f))
    .sort();

if (yamlFiles.length === 0) {
    console.warn("変換対象の TEST-*.yaml が見つかりません。");
    process.exit(0);
}

const wb = new ExcelJS.Workbook();
wb.creator = "gen_excel.mjs";
wb.modified = new Date();

buildCommonSheet(wb.addWorksheet(), pre);

for (const file of yamlFiles) {
    const spec = yaml.load(readFileSync(join(specDir, file), "utf-8"));
    const stepNoById = buildSpecSheet(wb.addWorksheet(), spec);
    buildEvidenceSheet(wb, spec, file, specDir, stepNoById);
    console.log(`  + ${file}`);
}

const outPath = join(outputDir, (() => {
    const now = new Date();
    const p = n => String(n).padStart(2, "0");
    const ts = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
    return `テスト仕様書_${ts}.xlsx`;
})());
await wb.xlsx.writeFile(outPath);
console.log(`\n✓ ${outPath}`);
