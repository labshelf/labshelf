// Adds units.effects_transitive to analysis/labshelf.db (run after extract.mjs): a unit's own effects, plus
// `iface:<Type>` for every call through a method declared on a product interface or type (an injected port or deps
// object that `effects` only sees when it lives in core/src/ports), plus everything its resolved callees do.
// Run: node analysis/scripts/effects.mjs
import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "./lib.mjs";

const db = new DatabaseSync(DB_PATH);
const cols = db.prepare(`PRAGMA table_info(units)`).all().map((c) => c.name);
if (!cols.includes("effects_transitive")) db.exec(`ALTER TABLE units ADD COLUMN effects_transitive TEXT`);

const effects = new Map(db.prepare(`SELECT id, effects FROM units`).all().map((u) => [u.id, new Set(JSON.parse(u.effects))]));
for (const c of db.prepare(`SELECT caller_id, receiver_type FROM calls WHERE callee_kind IN ('MethodSignature', 'PropertySignature')
  AND callee_file IS NOT NULL AND callee_file <> 'external'`).all())
  effects.get(c.caller_id)?.add(`iface:${c.receiver_type ?? "?"}`);
const callees = new Map();
for (const c of db.prepare(`SELECT DISTINCT caller_id, callee_id FROM calls WHERE callee_id IS NOT NULL AND callee_id <> caller_id`).all())
  (callees.get(c.caller_id) ?? callees.set(c.caller_id, []).get(c.caller_id)).push(c.callee_id);
const parents = db.prepare(`SELECT id, parent_id FROM units WHERE parent_id IS NOT NULL`).all();

// fixed point: callee effects flow to callers, nested-unit effects flow to the enclosing unit
for (let changed = true, round = 0; changed && round < 100; round++) {
  changed = false;
  const grow = (to, from) => {
    const t = effects.get(to);
    for (const e of effects.get(from) ?? []) if (!t.has(e)) { t.add(e); changed = true; }
  };
  for (const [caller, list] of callees) for (const callee of list) grow(caller, callee);
  for (const { id, parent_id } of parents) grow(parent_id, id);
}
const upd = db.prepare(`UPDATE units SET effects_transitive = ? WHERE id = ?`);
db.exec("BEGIN");
for (const [id, set] of effects) upd.run(JSON.stringify([...set].sort()), id);
db.exec("COMMIT");
const r = db.prepare(`SELECT SUM(effects = '[]') direct_none, SUM(effects_transitive = '[]') transitive_none,
  SUM(effects = '[]' AND effects_transitive <> '[]') became_effectful FROM units`).get();
console.log(JSON.stringify(r));
db.close();
