// '$.a.b' や 'a.b' を ['a', 'b'] に正規化する。
function normalizeJsonPath(jsonPath: string): string[] {
    const trimmed = jsonPath.trim();
    const noRoot = trimmed.startsWith("$.") ? trimmed.slice(2) : trimmed.replace(/^\$/, "");
    return noRoot.split(".").filter(Boolean);
}

// 単純なドットパスをたどってネストされた値を取得する。
export function resolveJsonPath(source: unknown, jsonPath: string): unknown {
    const parts = normalizeJsonPath(jsonPath);
    let current: unknown = source;
    for (const part of parts) {
        if (current === null || typeof current !== "object" || !(part in (current as Record<string, unknown>))) {
            return undefined;
        }
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

// ループ回数抽出のため、取得結果が配列であることを保証する。
export function jsonPathArrayLength(source: unknown, jsonPath: string): number {
    const value = resolveJsonPath(source, jsonPath);
    if (!Array.isArray(value)) {
        throw new Error(`jsonPath '${jsonPath}' did not resolve to an array.`);
    }
    return value.length;
}
