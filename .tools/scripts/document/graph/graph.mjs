/**
 * ドキュメントグラフ サーバー
 * Node.js HTTP サーバーとして起動し、ブラウザでグラフを表示する
 * Usage: node graph.mjs
 * URL:   http://localhost:3333
 */
import { createServer } from "node:http";
import { readFileSync, readdirSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join, basename, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKSPACE, SCHEMA_DIR, getProjects, getDocTypes } from "../../shared/definitions.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = 3333;
const HTML_PATH = join(__dirname, "graph.html");
const PRESETS_DIR = join(__dirname, "presets");

// ------- Markdown parsing helpers -------

function parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    const result = {};
    for (const line of match[1].split("\n")) {
        const m = line.match(/^([\w_]+):\s*(.+)$/);
        if (m) result[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
    return result;
}

function parseWikilinks(content) {
    const links = new Set();
    const regex = /\[\[([^\]|#\n]+?)(?:[|#][^\]\n]*)?\]\]/g;
    let m;
    while ((m = regex.exec(content)) !== null) links.add(m[1].trim());
    return [...links];
}

// ------- Graph builder -------

function buildGraph() {
    const nodes = [];
    const byBasename = new Map(); // filename without .md → node
    const byFmId = new Map();    // frontmatter id → node

    for (const project of getProjects()) {
        for (const dt of getDocTypes(project.dir)) {
            if (!existsSync(dt.dir)) continue;
            let files;
            try { files = readdirSync(dt.dir).filter(f => f.endsWith(".md")); }
            catch { continue; }

            for (const filename of files) {
                const absPath = join(dt.dir, filename);
                let content;
                try { content = readFileSync(absPath, "utf-8"); } catch { continue; }

                const fm = parseFrontmatter(content);
                const nodeId = basename(filename, ".md");
                const node = {
                    id: nodeId,
                    fmId: fm.id || null,
                    type: dt.key,
                    typeLabel: dt.label,
                    status: fm.status || null,
                    project: project.name,
                    path: relative(WORKSPACE, absPath).replace(/\\/g, "/"),
                    _links: parseWikilinks(content),
                };
                nodes.push(node);
                byBasename.set(nodeId, node);
                if (fm.id) byFmId.set(fm.id, node);
            }
        }
    }

    // Resolve wikilinks → edges (deduplicated)
    const edgeSet = new Set();
    const edges = [];
    for (const node of nodes) {
        for (const link of node._links) {
            let target = byBasename.get(link) || byFmId.get(link);
            if (!target) {
                // Try prefix match: [[TASK-001]] → TASK-001_タイトル
                for (const [key, n] of byBasename) {
                    if (key.startsWith(link + "_") || link.startsWith(key + "_")) {
                        target = n;
                        break;
                    }
                }
            }
            if (target && target.id !== node.id) {
                const key = [node.id, target.id].sort().join("||");
                if (!edgeSet.has(key)) {
                    edgeSet.add(key);
                    edges.push({ source: node.id, target: target.id });
                }
            }
        }
    }

    // Strip internal _links from response
    return {
        nodes: nodes.map(({ _links, ...n }) => n),
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
            const files = readdirSync(SCHEMA_DIR).filter(f => f.endsWith(".json"));
            const result = {};
            for (const f of files) {
                const d = JSON.parse(readFileSync(join(SCHEMA_DIR, f), "utf-8"));
                if (d.key) result[d.key] = {
                    label: d.label || d.key,
                    statuses: Array.isArray(d.statuses)
                        ? d.statuses.map(s => (typeof s === "object" ? s.code : s))
                        : null
                };
            }
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
            const files = readdirSync(PRESETS_DIR).filter(f => f.endsWith(".json"));
            const presets = files.map(f => {
                const name = basename(f, ".json");
                const data = JSON.parse(readFileSync(join(PRESETS_DIR, f), "utf-8"));
                return { name, selectedStatuses: data.selectedStatuses ?? {} };
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
                // Allow Japanese and other Unicode; block only path-unsafe chars
                if (!name || /[\/\\<>:|?*\x00-\x1f]/.test(name)) {
                    res.writeHead(400); res.end("Invalid name"); return;
                }
                const filePath = join(PRESETS_DIR, name + ".json");
                writeFileSync(filePath, JSON.stringify({ name, selectedStatuses, selectedTypes }, null, 2), "utf-8");
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
