"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateStore = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
// 実行ごとのスナップショットを永続化する。
class StateStore {
    runDir;
    statePath;
    constructor(baseDir, stateDir, runId) {
        this.runDir = node_path_1.default.resolve(baseDir, stateDir, runId);
        this.statePath = node_path_1.default.join(this.runDir, "state.json");
        (0, node_fs_1.mkdirSync)(this.runDir, { recursive: true });
    }
    // 実行スナップショットを保存する。
    save(state) {
        (0, node_fs_1.writeFileSync)(this.statePath, JSON.stringify(state, null, 2), "utf8");
    }
    // ログを1件追加して即時保存し、UIから見えるようにする。
    appendLog(state, log) {
        const nextState = {
            ...state,
            logs: [...state.logs, log]
        };
        this.save(nextState);
        return nextState;
    }
}
exports.StateStore = StateStore;
