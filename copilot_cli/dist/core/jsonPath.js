"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveJsonPath = resolveJsonPath;
exports.jsonPathArrayLength = jsonPathArrayLength;
// '$.a.b' や 'a.b' を ['a', 'b'] に正規化する。
function normalizeJsonPath(jsonPath) {
    const trimmed = jsonPath.trim();
    const noRoot = trimmed.startsWith("$.") ? trimmed.slice(2) : trimmed.replace(/^\$/, "");
    return noRoot.split(".").filter(Boolean);
}
// 単純なドットパスをたどってネストされた値を取得する。
function resolveJsonPath(source, jsonPath) {
    const parts = normalizeJsonPath(jsonPath);
    let current = source;
    for (const part of parts) {
        if (current === null || typeof current !== "object" || !(part in current)) {
            return undefined;
        }
        current = current[part];
    }
    return current;
}
// ループ回数抽出のため、取得結果が配列であることを保証する。
function jsonPathArrayLength(source, jsonPath) {
    const value = resolveJsonPath(source, jsonPath);
    if (!Array.isArray(value)) {
        throw new Error(`jsonPath '${jsonPath}' did not resolve to an array.`);
    }
    return value.length;
}
