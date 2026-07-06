import { spawnSync } from "node:child_process";
import process from "node:process";

// Windows では 'net session' が成功するのは管理者権限時のみ。
function isWindowsAdmin(): boolean {
    const check = spawnSync("net", ["session"], { encoding: "utf8" });
    return check.status === 0;
}

// Unix系では uid 0 が root を示す。
function isUnixAdmin(): boolean {
    return typeof process.getuid === "function" && process.getuid() === 0;
}

// 設定またはCLIで要求された場合のみ管理者モードを強制する。
export function ensureAdminMode(required: boolean): void {
    if (!required) {
        return;
    }

    const ok = process.platform === "win32" ? isWindowsAdmin() : isUnixAdmin();
    if (!ok) {
        throw new Error("Admin mode is required. Re-run this command with elevated privileges.");
    }
}
