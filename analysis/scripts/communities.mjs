// Adds file communities to analysis/labshelf.db (run after extract.mjs): Louvain modularity clustering of the
// undirected file graph, weighted by imported names (resolved through barrels to the declaring file) plus resolved
// unit-to-unit calls. Scopes: each package alone and all three together. Barrel files are left out.
// Run: node analysis/scripts/communities.mjs
import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "./lib.mjs";

const db = new DatabaseSync(DB_PATH);
db.exec(`DROP TABLE IF EXISTS communities; DROP TABLE IF EXISTS community_summary;
CREATE TABLE communities (file TEXT, scope TEXT, level INTEGER, community INTEGER);
CREATE TABLE community_summary (scope TEXT, level INTEGER, community INTEGER, files INTEGER, lines INTEGER, units INTEGER,
  dirs INTEGER, top_dirs TEXT, dir_purity REAL, internal_weight REAL, external_weight REAL, packages TEXT);`);

const files = db.prepare(`SELECT path, package, dir, lines, units FROM files WHERE is_barrel = 0`).all();
const info = new Map(files.map((f) => [f.path, f]));
const raw = [
  ...db.prepare(`SELECT n.from_file a, n.decl_file b, COUNT(*) w FROM import_names n WHERE n.decl_file IS NOT NULL
    AND n.decl_file <> n.from_file GROUP BY 1, 2`).all(),
  ...db.prepare(`SELECT c.file a, u.file b, COUNT(*) w FROM calls c JOIN units u ON u.id = c.callee_id
    WHERE u.file <> c.file GROUP BY 1, 2`).all(),
].filter((e) => info.has(e.a) && info.has(e.b));

// Louvain (Blondel et al. 2008): local moving, then aggregation, until modularity stops improving.
function louvain(nodeCount, edgeList) {
  let n = nodeCount;
  let adj = Array.from({ length: n }, () => new Map());
  for (const [a, b, w] of edgeList) {
    if (a === b) continue;
    adj[a].set(b, (adj[a].get(b) ?? 0) + w);
    adj[b].set(a, (adj[b].get(a) ?? 0) + w);
  }
  let membership = Array.from({ length: nodeCount }, (_, i) => i);
  const levels = [];
  let selfLoops = new Array(n).fill(0);
  for (;;) {
    const deg = adj.map((m, i) => [...m.values()].reduce((s, w) => s + w, 0) + 2 * selfLoops[i]);
    const m2 = deg.reduce((s, d) => s + d, 0);
    if (m2 === 0) break;
    const comm = Array.from({ length: n }, (_, i) => i);
    const tot = deg.slice();
    let moved = true, anyMove = false, rounds = 0;
    while (moved && rounds++ < 50) {
      moved = false;
      for (let i = 0; i < n; i++) {
        const ci = comm[i];
        const links = new Map();
        for (const [j, w] of adj[i]) links.set(comm[j], (links.get(comm[j]) ?? 0) + w);
        tot[ci] -= deg[i];
        let best = ci, bestGain = (links.get(ci) ?? 0) - (tot[ci] * deg[i]) / m2;
        for (const [c, w] of links) {
          const gain = w - (tot[c] * deg[i]) / m2;
          if (gain > bestGain + 1e-12) { best = c; bestGain = gain; }
        }
        tot[best] += deg[i];
        if (best !== ci) { comm[i] = best; moved = true; anyMove = true; }
      }
    }
    if (!anyMove) break;
    const ids = new Map();
    for (const c of comm) if (!ids.has(c)) ids.set(c, ids.size);
    membership = membership.map((x) => ids.get(comm[x]));
    levels.push(membership.slice());
    const k = ids.size;
    const next = Array.from({ length: k }, () => new Map());
    const nextSelf = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      nextSelf[ids.get(comm[i])] += selfLoops[i];
      for (const [j, w] of adj[i]) {
        const a = ids.get(comm[i]), b = ids.get(comm[j]);
        if (a === b) nextSelf[a] += w / 2;
        else next[a].set(b, (next[a].get(b) ?? 0) + w);
      }
    }
    if (k === n) break;
    adj = next; selfLoops = nextSelf; n = k;
  }
  return levels;
}

const insC = db.prepare(`INSERT INTO communities VALUES (?,?,?,?)`);
const insS = db.prepare(`INSERT INTO community_summary VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
db.exec("BEGIN");
for (const scope of ["core", "vscode", "browser", "all"]) {
  const nodes = files.filter((f) => scope === "all" || f.package === scope).map((f) => f.path);
  const index = new Map(nodes.map((p, i) => [p, i]));
  const edges = raw.filter((e) => index.has(e.a) && index.has(e.b)).map((e) => [index.get(e.a), index.get(e.b), e.w]);
  const levels = louvain(nodes.length, edges);
  // keep the finest level and the final one
  const keep = levels.length > 1 ? [[0, levels[0]], [levels.length - 1, levels[levels.length - 1]]] : levels.map((l, i) => [i, l]);
  for (const [level, membership] of keep) {
    const groups = new Map();
    nodes.forEach((p, i) => {
      insC.run(p, scope, level, membership[i]);
      (groups.get(membership[i]) ?? groups.set(membership[i], []).get(membership[i])).push(p);
    });
    for (const [c, ps] of groups) {
      const set = new Set(ps);
      const dirCount = new Map();
      for (const p of ps) dirCount.set(info.get(p).dir, (dirCount.get(info.get(p).dir) ?? 0) + 1);
      const top = [...dirCount].sort((a, b) => b[1] - a[1]);
      let inside = 0, outside = 0;
      for (const [a, b, w] of edges) {
        const ia = set.has(nodes[a]), ib = set.has(nodes[b]);
        if (ia && ib) inside += w; else if (ia || ib) outside += w;
      }
      insS.run(scope, level, c, ps.length, ps.reduce((s, p) => s + info.get(p).lines, 0), ps.reduce((s, p) => s + info.get(p).units, 0),
        dirCount.size, JSON.stringify(top.slice(0, 4)), Math.round((top[0][1] / ps.length) * 100) / 100, inside, outside,
        [...new Set(ps.map((p) => info.get(p).package))].sort().join(","));
    }
  }
  console.log(`${scope}: ${nodes.length} files, ${edges.length} edges, levels ${levels.map((l) => new Set(l).size).join(" > ")}`);
}
db.exec("COMMIT");
db.close();
