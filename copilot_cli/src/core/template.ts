// プロンプトとパスのテンプレート内で {{topic}} のようなプレースホルダを扱う。
const TEMPLATE_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

// すべてのプレースホルダを文字列化した変数値で置換する。
export function renderTemplate(template: string, vars: Record<string, unknown>): string {
    return template.replace(TEMPLATE_RE, (_all, key: string) => {
        const value = vars[key];
        if (value === undefined || value === null) {
            return "";
        }
        return String(value);
    });
}
