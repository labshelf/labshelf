// Adds clone families to analysis/labshelf.db (run after extract.mjs). Tiers and thresholds:
//   T1      identical normalized tokens, unit >= 20 nodes                       reliable
//   T2      identical once unit locals are renamed, unit >= 30 nodes            reliable
//   near    Jaccard >= 0.8 on 4-shingles of the T2 stream, unit >= 30 nodes     warning
//   inline  identical T2 window of 2-6 consecutive statements, >= 15 nodes      warning
//   name-variant  same free-function name (no class or object owner) in >= 2 files, >= 10 nodes, identical or flat-shingle Jaccard >= 0.6   review
// Shingles abstract every unit local to one `$` ("flat"): with numbered placeholders one extra parameter shifts every
// later name, and two copies of isInside that differ only by an injected PathOps score 0.14 instead of 0.64.
// Run: node analysis/scripts/clones.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_PATH, ROOT, isUnitNode, loadTypeScript, localNames, tokenStream } from "./lib.mjs";

const ts = loadTypeScript();
const T1_MIN = 20, T2_MIN = 30, NEAR_MIN = 30, NEAR_SIM = 0.8, INLINE_MIN = 15, WIN_MIN = 2, WIN_MAX = 6;
const NAME_MIN = 10, NAME_SIM = 0.6;
const db = new DatabaseSync(DB_PATH);
db.exec(`
DROP TABLE IF EXISTS clone_families; DROP TABLE IF EXISTS clone_members; DROP TABLE IF EXISTS clone_pairs; DROP TABLE IF EXISTS homonyms;
CREATE TABLE clone_families (id INTEGER PRIMARY KEY, tier TEXT, precision TEXT, members INTEGER, files INTEGER,
  packages TEXT, distinct_names INTEGER, names TEXT, nodes_min INTEGER, nodes_max INTEGER, sim_min REAL, sim_max REAL,
  redundant INTEGER DEFAULT 0, hash TEXT);
CREATE TABLE clone_members (family_id INTEGER, unit_id INTEGER, file TEXT, start_line INTEGER, end_line INTEGER,
  name TEXT, nodes INTEGER, stmt_start INTEGER, stmt_len INTEGER, whole_body INTEGER);
CREATE TABLE clone_pairs (family_id INTEGER, a INTEGER, b INTEGER, sim REAL);
CREATE TABLE homonyms (name TEXT PRIMARY KEY, units INTEGER, files INTEGER, packages TEXT, exported INTEGER,
  identical_pairs INTEGER, variant_pairs INTEGER, pairs INTEGER, max_sim REAL, verdict TEXT);
`);

const units = db.prepare(`SELECT id, file, name, owner, nodes, t1, t2, parent_id, start_line, end_line FROM units ORDER BY id`).all();
const kindOf = new Map(db.prepare(`SELECT id, kind FROM units`).all().map((r) => [r.id, r.kind]));
const byId = new Map(units.map((u) => [u.id, u]));
const byFile = new Map();
for (const u of units) (byFile.get(u.file) ?? byFile.set(u.file, []).get(u.file)).push(u);
const label = (u) => (u.owner ? `${u.owner}.${u.name}` : u.name);

// ---------- re-walk every file to get shingles and statement windows ----------
const fnv = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
};
const shingles = new Map(); // unit id -> Uint32Array (sorted unique)
const windows = new Map(); // hash -> [{unitId, block, i, k, nodes, start, end, whole}]
let blockSeq = 0;
for (const [file, list] of byFile) {
  const text = readFileSync(join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const nodes = [];
  const collect = (n) => { if (isUnitNode(n)) nodes.push(n); ts.forEachChild(n, collect); };
  collect(sf);
  if (nodes.length !== list.length) throw new Error(`unit count mismatch in ${file}: ${nodes.length} vs ${list.length}`);
  const line = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  nodes.forEach((n, idx) => {
    const u = list[idx];
    const locals = localNames(n);
    if (u.nodes >= NAME_MIN) {
      const { toks } = tokenStream([...n.parameters, n.body], locals, "flat");
      const set = new Set();
      for (let i = 0; i + 4 <= toks.length; i++) set.add(fnv(toks.slice(i, i + 4).join(" ")));
      shingles.set(u.id, Uint32Array.from(set).sort());
    }
    // blocks owned by this unit (not by a nested unit)
    const blocks = [];
    const findBlocks = (m) => {
      if (m !== n && isUnitNode(m)) return;
      if (ts.isBlock(m) || ts.isCaseClause(m) || ts.isDefaultClause(m)) blocks.push(m);
      ts.forEachChild(m, findBlocks);
    };
    findBlocks(n.body);
    for (const b of blocks) {
      const stmts = b.statements;
      const bid = blockSeq++;
      const sizes = stmts.map((s) => tokenStream([s], locals, false).count);
      for (let k = WIN_MIN; k <= Math.min(WIN_MAX, stmts.length); k++) {
        for (let i = 0; i + k <= stmts.length; i++) {
          let size = 0;
          for (let j = i; j < i + k; j++) size += sizes[j];
          if (size < INLINE_MIN) continue;
          const { toks } = tokenStream(stmts.slice(i, i + k), locals, true);
          const h = createHash("sha1").update(toks.join(" ")).digest("hex").slice(0, 16);
          const w = { unitId: u.id, block: bid, i, k, nodes: size, start: line(stmts[i].getStart(sf)), end: line(stmts[i + k - 1].end),
            whole: b === n.body && i === 0 && k === stmts.length ? 1 : 0 };
          (windows.get(h) ?? windows.set(h, []).get(h)).push(w);
        }
      }
    }
  });
}
console.log(`shingled units: ${shingles.size}, window hashes: ${windows.size}`);

// ---------- writers ----------
const insFam = db.prepare(`INSERT INTO clone_families (id, tier, precision, members, files, packages, distinct_names, names,
  nodes_min, nodes_max, sim_min, sim_max, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insMem = db.prepare(`INSERT INTO clone_members VALUES (?,?,?,?,?,?,?,?,?,?)`);
const insPair = db.prepare(`INSERT INTO clone_pairs VALUES (?,?,?,?)`);
let famId = 1;
const unitFamily = new Map(); // unit id -> [family ids] for unit tiers
function writeUnitFamily(tier, precision, ids, hash, simMin = 1, simMax = 1) {
  const us = ids.map((i) => byId.get(i));
  const id = famId++;
  const names = [...new Set(us.map(label))];
  insFam.run(id, tier, precision, us.length, new Set(us.map((u) => u.file)).size, [...new Set(us.map((u) => u.file.split("/")[1]))].sort().join(","),
    names.length, names.slice(0, 12).join(", "), Math.min(...us.map((u) => u.nodes)), Math.max(...us.map((u) => u.nodes)), simMin, simMax, hash);
  for (const u of us) {
    insMem.run(id, u.id, u.file, u.start_line, u.end_line, label(u), u.nodes, null, null, 1);
    (unitFamily.get(u.id) ?? unitFamily.set(u.id, []).get(u.id)).push(id);
  }
  return id;
}
const group = (rows, key) => {
  const m = new Map();
  for (const r of rows) (m.get(r[key]) ?? m.set(r[key], []).get(r[key])).push(r);
  return m;
};

db.exec("BEGIN");
// T1 and T2
for (const [h, us] of group(units.filter((u) => u.nodes >= T1_MIN), "t1")) if (us.length > 1) writeUnitFamily("T1", "reliable", us.map((u) => u.id), h);
for (const [h, us] of group(units.filter((u) => u.nodes >= T2_MIN), "t2"))
  if (us.length > 1 && new Set(us.map((u) => u.t1)).size > 1) writeUnitFamily("T2", "reliable", us.map((u) => u.id), h);

// near clones: MinHash LSH (16 bands x 4 rows) then exact Jaccard
const PERMS = 64, ROWS = 4;
const seeds = Array.from({ length: PERMS }, (_, i) => [(Math.imul(i + 1, 0x9e3779b1) | 1) >>> 0, Math.imul(i + 7, 0x85ebca6b) >>> 0]);
const sig = new Map();
for (const [id, set] of shingles) {
  if (byId.get(id).nodes < NEAR_MIN) continue;
  const s = new Uint32Array(PERMS).fill(0xffffffff);
  for (const x of set) for (let p = 0; p < PERMS; p++) {
    const v = (Math.imul(x ^ seeds[p][1], seeds[p][0]) ^ (x >>> 13)) >>> 0;
    if (v < s[p]) s[p] = v;
  }
  sig.set(id, s);
}
const isAncestor = (a, b) => { for (let p = byId.get(b).parent_id; p; p = byId.get(p).parent_id) if (p === a) return true; return false; };
const jaccard = (a, b) => {
  let i = 0, j = 0, inter = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { inter++; i++; j++; } else if (a[i] < b[j]) i++; else j++; }
  return inter / (a.length + b.length - inter);
};
const candidates = new Set();
for (let band = 0; band < PERMS / ROWS; band++) {
  const buckets = new Map();
  for (const [id, s] of sig) {
    const key = Array.from(s.subarray(band * ROWS, band * ROWS + ROWS)).join(",");
    (buckets.get(key) ?? buckets.set(key, []).get(key)).push(id);
  }
  for (const ids of buckets.values()) {
    if (ids.length < 2 || ids.length > 400) continue;
    for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) candidates.add(ids[x] < ids[y] ? `${ids[x]},${ids[y]}` : `${ids[y]},${ids[x]}`);
  }
}
const parentOf = new Map(units.map((u) => [u.id, u.id]));
const find = (x) => { while (parentOf.get(x) !== x) { parentOf.set(x, parentOf.get(parentOf.get(x))); x = parentOf.get(x); } return x; };
const pairs = [];
for (const key of candidates) {
  const [a, b] = key.split(",").map(Number);
  const ua = byId.get(a), ub = byId.get(b);
  if (ua.t2 === ub.t2) continue;
  const sa = shingles.get(a), sb = shingles.get(b);
  if (Math.min(sa.length, sb.length) / Math.max(sa.length, sb.length) < NEAR_SIM) continue;
  if (isAncestor(a, b) || isAncestor(b, a)) continue;
  const sim = jaccard(sa, sb);
  if (sim >= NEAR_SIM) { pairs.push([a, b, sim]); parentOf.set(find(a), find(b)); }
}
const nearGroups = group(pairs.flatMap(([a, b]) => [{ id: a, root: find(a) }, { id: b, root: find(b) }]), "root");
for (const [root, list] of nearGroups) {
  const ids = [...new Set(list.map((x) => x.id))];
  const ps = pairs.filter(([a]) => find(a) === root);
  const fid = writeUnitFamily("near", "warning", ids, null, Math.min(...ps.map((p) => p[2])), Math.max(...ps.map((p) => p[2])));
  for (const [a, b, s] of ps) insPair.run(fid, a, b, Math.round(s * 1000) / 1000);
}
console.log(`near candidates ${candidates.size}, pairs ${pairs.length}`);

// unit families whose members all sit inside members of one other family are redundant
db.exec(`UPDATE clone_families SET redundant = 1 WHERE tier IN ('T1','T2','near') AND NOT EXISTS (
  SELECT 1 FROM clone_members m JOIN units u ON u.id = m.unit_id WHERE m.family_id = clone_families.id
    AND (u.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM clone_members pm WHERE pm.unit_id = u.parent_id AND pm.family_id <> clone_families.id)))`);

// name-variant: same-named free functions in different files that are identical at any size or similar
const FREE = new Set(["function", "arrow", "function-expr"]);
const insHom = db.prepare(`INSERT INTO homonyms VALUES (?,?,?,?,?,?,?,?,?,?)`);
const exportedOf = new Map(db.prepare(`SELECT id, exported FROM units`).all().map((r) => [r.id, r.exported]));
for (const [name, list] of group(units.filter((u) => FREE.has(kindOf.get(u.id)) && !u.owner && !u.name.startsWith("<anon>")), "name")) {
  if (new Set(list.map((u) => u.file)).size < 2) continue;
  const root = new Map(list.map((u) => [u.id, u.id]));
  const fr = (x) => { while (root.get(x) !== x) x = root.get(x); return x; };
  let identical = 0, variant = 0, pairsN = 0, maxSim = 0;
  const edges = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.file === b.file) continue;
    pairsN++;
    const same = a.t1 === b.t1 || a.t2 === b.t2;
    const sa = shingles.get(a.id), sb = shingles.get(b.id);
    const sim = same ? 1 : sa && sb ? jaccard(sa, sb) : 0;
    maxSim = Math.max(maxSim, sim);
    if (same) identical++;
    else if (sim >= NAME_SIM) variant++;
    if ((same || sim >= NAME_SIM) && Math.min(a.nodes, b.nodes) >= NAME_MIN) { edges.push([a.id, b.id, sim]); root.set(fr(a.id), fr(b.id)); }
  }
  const verdict = identical === pairsN ? "identical" : identical + variant === 0 ? "different" : variant === 0 && identical > 0 ? "identical-subset" : "variant";
  insHom.run(name, list.length, new Set(list.map((u) => u.file)).size, [...new Set(list.map((u) => u.file.split("/")[1]))].sort().join(","),
    list.filter((u) => exportedOf.get(u.id)).length, identical, variant, pairsN, Math.round(maxSim * 100) / 100, verdict);
  for (const ids of group(edges.flatMap(([a, b]) => [{ id: a, r: fr(a) }, { id: b, r: fr(b) }]), "r").values()) {
    const memberIds = [...new Set(ids.map((x) => x.id))];
    const covered = [...(unitFamily.get(memberIds[0]) ?? [])].some((f) => memberIds.every((m) => (unitFamily.get(m) ?? []).includes(f)));
    if (covered) continue;
    const es = edges.filter(([a]) => fr(a) === ids[0].r);
    const fid = writeUnitFamily("name-variant", "review", memberIds, null, Math.min(...es.map((e) => e[2])), Math.max(...es.map((e) => e[2])));
    for (const [a, b, sim] of es) insPair.run(fid, a, b, Math.round(sim * 1000) / 1000);
  }
}

// inline windows: non-overlapping identical windows, maximal, not already covered by a unit clone family
const winKey = (w) => `${w.block}:${w.i}:${w.k}`;
const famOfWindow = new Map();
const inlineFams = [];
for (const [h, ws] of windows) {
  const chosen = [];
  for (const w of ws.sort((a, b) => a.block - b.block || a.i - b.i)) {
    const last = chosen[chosen.length - 1];
    if (last && last.block === w.block && w.i < last.i + last.k) continue;
    chosen.push(w);
  }
  if (chosen.length < 2) continue;
  const fam = { h, ws: chosen };
  inlineFams.push(fam);
  for (const w of chosen) famOfWindow.set(winKey(w), fam);
}
let suppressed = 0, covered = 0;
for (const fam of inlineFams) {
  const w0 = fam.ws[0];
  const ext = [famOfWindow.get(`${w0.block}:${w0.i - 1}:${w0.k + 1}`), famOfWindow.get(`${w0.block}:${w0.i}:${w0.k + 1}`)];
  const keys = (f) => new Set(f.ws.map(winKey));
  fam.dropped = ext.some((g) => {
    if (!g || g === fam) return false;
    const gk = keys(g);
    return fam.ws.every((w) => gk.has(`${w.block}:${w.i - 1}:${w.k + 1}`) || gk.has(`${w.block}:${w.i}:${w.k + 1}`));
  });
  if (fam.dropped) { suppressed++; continue; }
  // covered: every member's unit (or an ancestor) shares a unit-tier family with the other members
  const fams = fam.ws.map((w) => {
    const s = new Set();
    for (let u = w.unitId; u; u = byId.get(u).parent_id) for (const f of unitFamily.get(u) ?? []) s.add(f);
    return s;
  });
  const common = [...fams[0]].filter((f) => fams.every((s) => s.has(f)));
  if (common.length) { covered++; continue; }
  const id = famId++;
  const us = fam.ws.map((w) => byId.get(w.unitId));
  const names = [...new Set(us.map(label))];
  insFam.run(id, "inline", "warning", fam.ws.length, new Set(us.map((u) => u.file)).size, [...new Set(us.map((u) => u.file.split("/")[1]))].sort().join(","),
    names.length, names.slice(0, 12).join(", "), Math.min(...fam.ws.map((w) => w.nodes)), Math.max(...fam.ws.map((w) => w.nodes)), 1, 1, fam.h);
  for (const w of fam.ws) {
    const u = byId.get(w.unitId);
    insMem.run(id, u.id, u.file, w.start, w.end, label(u), w.nodes, w.i, w.k, w.whole);
  }
}
db.exec("COMMIT");
console.log(`inline: ${inlineFams.length} raw, ${suppressed} non-maximal, ${covered} covered by unit clones`);
db.exec(`CREATE INDEX IF NOT EXISTS cm_fam ON clone_members(family_id); CREATE INDEX IF NOT EXISTS cm_unit ON clone_members(unit_id);`);
for (const r of db.prepare(`SELECT tier, COUNT(*) n, SUM(members) m, SUM(redundant) r FROM clone_families GROUP BY tier`).all()) console.log(JSON.stringify(r));
db.close();
