"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAdminMode = ensureAdminMode;
const node_child_process_1 = require("node:child_process");
const node_process_1 = __importDefault(require("node:process"));
// Windows では 'net session' が成功するのは管理者権限時のみ。
function isWindowsAdmin() {
    const check = (0, node_child_process_1.spawnSync)("net", ["session"], { encoding: "utf8" });
    return check.status === 0;
}
// Unix系では uid 0 が root を示す。
function isUnixAdmin() {
    return typeof node_process_1.default.getuid === "function" && node_process_1.default.getuid() === 0;
}
// 設定またはCLIで要求された場合のみ管理者モードを強制する。
function ensureAdminMode(required) {
    if (!required) {
        return;
    }
    const ok = node_process_1.default.platform === "win32" ? isWindowsAdmin() : isUnixAdmin();
    if (!ok) {
        throw new Error("Admin mode is required. Re-run this command with elevated privileges.");
    }
}
