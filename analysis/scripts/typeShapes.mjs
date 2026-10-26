// Adds type_pairs to analysis/labshelf.db (run after extract.mjs): pairs of object-like type declarations with at
// least 3 members whose member names overlap with Jaccard >= 0.8, plus how many members also agree on their type.
// Identical shapes are already visible as equal types.shape_hash. Run: node analysis/scripts/typeShapes.mjs
import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "./lib.mjs";

const MIN_MEMBERS = 3, MIN_SIM = 0.8;
const db = new DatabaseSync(DB_PATH);
db.exec(`DROP TABLE IF EXISTS type_pairs;
CREATE TABLE type_pairs (a INTEGER, b INTEGER, name_a TEXT, name_b TEXT, file_a TEXT, file_b TEXT, same_hash INTEGER,
  name_sim REAL, typed_sim REAL, members_a INTEGER, members_b INTEGER);`);
const types = db.prepare(`SELECT id, name, file, shape, shape_hash, member_names FROM types
  WHERE kind IN ('interface','alias') AND shape LIKE '{%' AND members >= ?`).all(MIN_MEMBERS)
  .map((t) => {
    const names = new Set(JSON.parse(t.member_names));
    // shape is {a:T;b?:U;...}; split on ";" only at depth 0
    const typed = new Set();
    let depth = 0, cur = "";
    for (const ch of t.shape.slice(1, -1)) {
      if ("{([<".includes(ch)) depth++;
      if ("})]>".includes(ch)) depth--;
      if (ch === ";" && depth === 0) { typed.add(cur); cur = ""; } else cur += ch;
    }
    if (cur) typed.add(cur);
    return { ...t, names, typed };
  });
const jac = (a, b) => {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i);
};
const ins = db.prepare(`INSERT INTO type_pairs VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
db.exec("BEGIN");
let n = 0;
for (let i = 0; i < types.length; i++) for (let j = i + 1; j < types.length; j++) {
  const a = types[i], b = types[j];
  if (a.file === b.file && a.name === b.name) continue;
  const small = Math.min(a.names.size, b.names.size), big = Math.max(a.names.size, b.names.size);
  if (small / big < MIN_SIM) continue;
  const s = jac(a.names, b.names);
  if (s < MIN_SIM) continue;
  ins.run(a.id, b.id, a.name, b.name, a.file, b.file, a.shape_hash === b.shape_hash ? 1 : 0, Math.round(s * 100) / 100,
    Math.round(jac(a.typed, b.typed) * 100) / 100, a.names.size, b.names.size);
  n++;
}
db.exec("COMMIT");
console.log(`type pairs: ${n} (of ${types.length} object-like types)`);
db.close();
