// Control checks for analysis/labshelf.db: known duplicate helpers must form clone families and a known homonym with
// different behaviour must not. Exits 1 on a failed control. Run: node analysis/scripts/validate.mjs
import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "./lib.mjs";

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const familiesOf = db.prepare(`SELECT DISTINCT f.tier, f.members, f.sim_min FROM clone_families f
  JOIN clone_members m ON m.family_id = f.id JOIN units u ON u.id = m.unit_id WHERE u.name = ?`);
const controls = [
  { name: "hostOf", expect: true },
  { name: "exists", expect: true },
  { name: "isInside", expect: true },
  { name: "readJson", expect: false },
];
let failed = 0;
for (const c of controls) {
  const fams = familiesOf.all(c.name);
  const ok = fams.length > 0 === c.expect;
  if (!ok) failed++;
  const hom = db.prepare(`SELECT verdict, max_sim FROM homonyms WHERE name = ?`).get(c.name);
  console.log(`${ok ? "PASS" : "FAIL"} ${c.name}: ${fams.length} families ${JSON.stringify(fams)} homonym ${JSON.stringify(hom)}`);
}
process.exit(failed ? 1 : 0);
