/**
 * ドキュメントグラフ サーバー
 * Node.js HTTP サーバーとして起動し、ブラウザでグラフを表示する
 * Usage: node graph.mjs
 * URL:   http://localhost:3333
 */
import { createServer } from "node:http";
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { join, basename, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { WORKSPACE, SCHEMA_DIR, getProjects, getDocTypes } from "../../shared/definitions.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = 3333;
const HTML_PATH = join(__dirname, "graph.html");
const PRESETS_DIR = join(__dirname, "presets");

// source type -> target array field
const TRACEABILITY_FIELDS = {
    issue: ["decisions"],
    risk: ["decisions"],
    meeting_note: ["issues"],
    decision: ["requirements"],
    requirement: ["specifications"],
    change_level2: ["specifications", "releases"],
    mod_project: ["requirements"],
    specification: ["tests"],
    test_case: ["releases"],
    ticket_level1: ["tests"],
    manual: ["releases"],
    runbook: ["releases"],
    customer_artifact: ["releases"],
};

// ------- Markdown parsing helpers -------

function parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    try {
        const data = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
        return typeof data === "object" && data !== null ? data : {};
    } catch {
        return {};
    }
}

function collectMarkdownFiles(dir, out = []) {
    if (!existsSync(dir)) return out;
    const entries = readdirSync(dir);
    for (const name of entries) {
        const p = join(dir, name);
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) {
            collectMarkdownFiles(p, out);
        } else if (st.isFile() && name.toLowerCase().endsWith(".md")) {
            out.push(p);
        }
    }
    return out;
}

function normalizeRef(v) {
    if (typeof v !== "string") return null;
    let s = v.trim();
    if (!s) return null;
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }
    if (s.startsWith("![[") && s.endsWith("]]")) {
        s = s.slice(1);
    }
    const wiki = s.match(/^\[\[(.+?)\]\]$/);
    if (wiki) {
        const core = wiki[1].split("|")[0].split("#")[0].trim();
        return core.replace(/\.md$/i, "") || null;
    }
    const md = s.match(/^\[[^\]]*\]\(([^)]+)\)$/);
    if (md) {
        return md[1].split("#")[0].trim().replace(/\.md$/i, "") || null;
    }
    return s.split("#")[0].trim().replace(/\.md$/i, "") || null;
}

function extractRefs(value) {
    if (Array.isArray(value)) {
        return value.flatMap((v) => extractRefs(v));
    }
    if (typeof value !== "string") {
        return [];
    }

    const refs = [];

    // Obsidian / FOAM wiki links
    for (const m of value.matchAll(/\[\[([^\]]+)\]\]/g)) {
        const ref = normalizeRef(`[[${m[1]}]]`);
        if (ref) refs.push(ref);
    }

    // Markdown links
    for (const m of value.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const ref = normalizeRef(`[x](${m[1]})`);
        if (ref) refs.push(ref);
    }

    if (refs.length > 0) return refs;

    // Fallback: single plain ref
    const single = normalizeRef(value);
    return single ? [single] : [];
}

function getTargetIds(node) {
    const fields = TRACEABILITY_FIELDS[node.type] || [];
    const out = [];
    for (const key of fields) {
        const val = node.fm?.[key];
        out.push(...extractRefs(val));
    }
    return out;
}

function isCurrentSpecNode(nodeId, fm, docType) {
    if (!fm || typeof fm.id !== "string") return false;
    const fmId = fm.id.trim();
    if (!fmId) return false;

    // front matter id must satisfy the current schema prefix/pattern.
    if (docType.idRegex && !docType.idRegex.test(fmId)) return false;

    // Canonical filename is either "ID.md" or "ID_タイトル.md".
    return nodeId === fmId || nodeId.startsWith(fmId + "_");
}

function getCurrentDocTypeKeys() {
    const keys = new Set();
    for (const project of getProjects()) {
        for (const dt of getDocTypes(project.dir)) {
            keys.add(dt.key);
        }
    }
    if (keys.size === 0) {
        // Fallback for empty workspaces.
        for (const key of Object.keys(TRACEABILITY_FIELDS)) {
            keys.add(key);
        }
        keys.add("release_note");
    }
    return keys;
}

function loadSchemaStatusMap(allowedKeys = null) {
    const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".json"));
    const result = {};
    for (const f of files) {
        const d = JSON.parse(readFileSync(join(SCHEMA_DIR, f), "utf-8"));
        if (!d.key) continue;
        if (allowedKeys && !allowedKeys.has(d.key)) continue;
        result[d.key] = {
            label: d.label || d.key,
            statuses: Array.isArray(d.statuses)
                ? d.statuses.map((s) => (typeof s === "object" ? s.code : s))
                : null,
        };
    }
    return result;
}

function sanitizeSelectedStatuses(selectedStatuses, schemaMap) {
    if (!selectedStatuses || typeof selectedStatuses !== "object") return {};
    const out = {};
    for (const [typeKey, statuses] of Object.entries(selectedStatuses)) {
        const allowed = schemaMap[typeKey]?.statuses;
        if (!Array.isArray(allowed)) continue;
        if (!Array.isArray(statuses)) continue;
        const allowSet = new Set(allowed);
        const filtered = statuses
            .map((s) => String(s))
            .filter((s) => allowSet.has(s));
        if (filtered.length > 0) {
            out[typeKey] = [...new Set(filtered)];
        }
    }
    return out;
}

function sanitizeSelectedTypes(selectedTypes, allowedKeys) {
    if (!Array.isArray(selectedTypes)) return [];
    return [...new Set(selectedTypes.map((v) => String(v)).filter((v) => allowedKeys.has(v)))];
}

// ------- Graph builder -------

function buildGraph() {
    const nodes = [];
    const byBasename = new Map(); // filename without .md -> node
    const byFmId = new Map(); // frontmatter id -> node

    for (const project of getProjects()) {
        for (const dt of getDocTypes(project.dir)) {
            if (!existsSync(dt.dir)) continue;
            const files = collectMarkdownFiles(dt.dir);

            for (const absPath of files) {
                const filename = basename(absPath);
                let content;
                try { content = readFileSync(absPath, "utf-8"); } catch { continue; }

                const fm = parseFrontmatter(content);
                const nodeId = basename(filename, ".md");
                if (!isCurrentSpecNode(nodeId, fm, dt)) {
                    continue;
                }
                const node = {
                    id: nodeId,
                    fmId: fm.id || null,
                    type: dt.key,
                    typeLabel: dt.label,
                    status: fm.status || null,
                    project: project.name,
                    path: relative(WORKSPACE, absPath).replace(/\\/g, "/"),
                    fm,
                };
                nodes.push(node);
                byBasename.set(nodeId, node);
                if (fm.id) byFmId.set(fm.id, node);
            }
        }
    }

    // Resolve frontmatter references -> directed edges (deduplicated)
    const edgeSet = new Set();
    const edges = [];
    for (const node of nodes) {
        for (const ref of getTargetIds(node)) {
            let target = byFmId.get(ref) || byBasename.get(ref);
            if (!target) {
                // Try prefix match: ID -> ID_タイトル
                for (const [key, n] of byBasename) {
                    if (key.startsWith(ref + "_") || ref.startsWith(key + "_")) {
                        target = n;
                        break;
                    }
                }
            }
            if (target && target.id !== node.id) {
                const key = `${node.id}||${target.id}`;
                if (!edgeSet.has(key)) {
                    edgeSet.add(key);
                    edges.push({ source: node.id, target: target.id });
                }
            }
        }
    }

    return {
        nodes: nodes.map(({ fm, ...n }) => n),
        edges,
    };
}

// ------- HTTP server -------

const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    // Root → serve graph.html
    if (url.pathname === "/") {
        try {
            const html = readFileSync(HTML_PATH, "utf-8");
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(html);
        } catch {
            res.writeHead(500);
            res.end("graph.html が見つかりません");
        }
        return;
    }

    // Graph data
    if (url.pathname === "/api/graph") {
        try {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(buildGraph()));
        } catch (e) {
            res.writeHead(500);
            res.end(e.message);
        }
        return;
    }

    // Schema statuses
    if (url.pathname === "/api/schema") {
        try {
            const currentKeys = getCurrentDocTypeKeys();
            const result = loadSchemaStatusMap(currentKeys);
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(result));
        } catch (e) {
            res.writeHead(500); res.end(e.message);
        }
        return;
    }

    // Presets: GET list
    if (url.pathname === "/api/presets" && req.method === "GET") {
        try {
            const currentKeys = getCurrentDocTypeKeys();
            const schemaMap = loadSchemaStatusMap(currentKeys);
            const files = readdirSync(PRESETS_DIR).filter(f => f.endsWith(".json"));
            const presets = files.map(f => {
                const name = basename(f, ".json");
                const data = JSON.parse(readFileSync(join(PRESETS_DIR, f), "utf-8"));
                return {
                    name,
                    selectedStatuses: sanitizeSelectedStatuses(data.selectedStatuses ?? {}, schemaMap),
                    selectedTypes: sanitizeSelectedTypes(data.selectedTypes ?? [], currentKeys),
                };
            });
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(presets));
        } catch (e) {
            res.writeHead(500); res.end(e.message);
        }
        return;
    }

    // Presets: POST save
    if (url.pathname === "/api/presets" && req.method === "POST") {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
            try {
                const { name, selectedStatuses, selectedTypes } = JSON.parse(body);
                const currentKeys = getCurrentDocTypeKeys();
                const schemaMap = loadSchemaStatusMap(currentKeys);
                // Allow Japanese and other Unicode; block only path-unsafe chars
                if (!name || /[\/\\<>:|?*\x00-\x1f]/.test(name)) {
                    res.writeHead(400); res.end("Invalid name"); return;
                }
                const filePath = join(PRESETS_DIR, name + ".json");
                const normalized = {
                    name,
                    selectedStatuses: sanitizeSelectedStatuses(selectedStatuses, schemaMap),
                    selectedTypes: sanitizeSelectedTypes(selectedTypes, currentKeys),
                };
                writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf-8");
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ ok: true }));
            } catch (e) {
                res.writeHead(500); res.end(e.message);
            }
        });
        return;
    }

    // Presets: DELETE
    if (url.pathname === "/api/presets" && req.method === "DELETE") {
        const name = url.searchParams.get("name") || "";
        if (!name || /[/\\<>:|?*\x00-\x1f]/.test(name)) {
            res.writeHead(400); res.end("Invalid name"); return;
        }
        try {
            const filePath = resolve(PRESETS_DIR, name + ".json");
            if (!filePath.startsWith(PRESETS_DIR + sep)) {
                res.writeHead(403); res.end("Forbidden"); return;
            }
            unlinkSync(filePath);
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true }));
        } catch (e) {
            res.writeHead(500); res.end(e.message);
        }
        return;
    }

    // Status update: PATCH /api/status
    if (url.pathname === "/api/status" && req.method === "PATCH") {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
            try {
                const { path: rel, status } = JSON.parse(body);
                if (!rel || typeof status !== "string" || status.trim() === "") {
                    res.writeHead(400); res.end("Invalid params"); return;
                }
                const abs = resolve(WORKSPACE, rel);
                if (!abs.startsWith(WORKSPACE + sep)) {
                    res.writeHead(403); res.end("Forbidden"); return;
                }
                let content = readFileSync(abs, "utf-8");
                const fmMatch = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
                if (!fmMatch) { res.writeHead(400); res.end("No frontmatter"); return; }
                const [fullMatch, open, fmBody, close] = fmMatch;
                const newFmBody = /^status:/m.test(fmBody)
                    ? fmBody.replace(/^(status:\s*).*$/m, `$1${status.trim()}`)
                    : fmBody + `\nstatus: ${status.trim()}`;
                content = content.replace(fullMatch, open + newFmBody + close);
                writeFileSync(abs, content, "utf-8");
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ ok: true }));
            } catch (e) {
                res.writeHead(500); res.end(e.message);
            }
        });
        return;
    }

    // File content (path traversal guard)
    if (url.pathname === "/api/file") {
        const rel = url.searchParams.get("path") || "";
        const abs = resolve(WORKSPACE, rel);
        if (!abs.startsWith(WORKSPACE + sep)) {
            res.writeHead(403); res.end("Forbidden"); return;
        }
        try {
            const content = readFileSync(abs, "utf-8");
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(content);
        } catch {
            res.writeHead(404); res.end("Not found");
        }
        return;
    }

    res.writeHead(404); res.end();
});

server.listen(PORT, () => {
    console.log(`\nドキュメントグラフ: http://localhost:${PORT}`);
    console.log("Ctrl+C で停止\n");
});
