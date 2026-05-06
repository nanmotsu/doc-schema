/**
 * ログファイル出力ユーティリティ
 *
 * console.log をフックして、ターミナル出力と同時に
 * 0_schema/logs/<scriptName>_YYYYMMDD-HHmmss.log へ書き出す。
 */
import { createWriteStream, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_DIR = join(__dirname, "..", "logs");

export function setupLogger(scriptName) {
    mkdirSync(LOG_DIR, { recursive: true });

    const now = new Date();
    const ts =
        `${now.getFullYear()}` +
        `${String(now.getMonth() + 1).padStart(2, "0")}` +
        `${String(now.getDate()).padStart(2, "0")}` +
        `-` +
        `${String(now.getHours()).padStart(2, "0")}` +
        `${String(now.getMinutes()).padStart(2, "0")}` +
        `${String(now.getSeconds()).padStart(2, "0")}`;

    const logFile = join(LOG_DIR, `${scriptName}_${ts}.log`);
    const stream = createWriteStream(logFile, { encoding: "utf-8" });

    const origLog = console.log.bind(console);
    console.log = (...args) => {
        const line = args.map(String).join(" ");
        origLog(...args);
        stream.write(line + "\n");
    };

    return logFile;
}
