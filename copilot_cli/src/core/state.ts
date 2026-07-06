import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RuntimeState, StepLog } from "./types";

// 実行ごとのスナップショットを永続化する。
export class StateStore {
    private readonly runDir: string;
    private readonly statePath: string;

    constructor(baseDir: string, stateDir: string, runId: string) {
        this.runDir = path.resolve(baseDir, stateDir, runId);
        this.statePath = path.join(this.runDir, "state.json");
        mkdirSync(this.runDir, { recursive: true });
    }

    // 実行スナップショットを保存する。
    save(state: RuntimeState): void {
        writeFileSync(this.statePath, JSON.stringify(state, null, 2), "utf8");
    }

    // ログを1件追加して即時保存し、UIから見えるようにする。
    appendLog(state: RuntimeState, log: StepLog): RuntimeState {
        const nextState: RuntimeState = {
            ...state,
            logs: [...state.logs, log]
        };
        this.save(nextState);
        return nextState;
    }
}
