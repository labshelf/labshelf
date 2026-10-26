// Prints compact aggregates for analysis/typing.md (run typing.mjs first): per-concept counts, swap-risk signatures,
// argument/parameter name mismatches, escape counts and structurally equal types.
import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "./lib.mjs";
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const q = (sql) => db.prepare(sql).all();
const show = (t, rows) => { console.log(`\n## ${t}`); for (const r of rows) console.log(Object.values(r).join(" | ")); };

show("fine concept by package (prim/all)", q(`SELECT c.fine, SUM(v.package='core') core, SUM(v.package='vscode') vscode, SUM(v.package='browser') browser, COUNT(*) total, SUM(v.is_primitive) prim
 FROM value_concepts c JOIN "values" v ON v.id=c.value_id GROUP BY 1 ORDER BY total DESC LIMIT 45`));

// Swap risk: a unit with 2+ primitive string params whose fine concepts differ.
const swap = q(`SELECT u.id, u.file, u.name, u.signature, GROUP_CONCAT(c.fine||':'||v.name) ps, COUNT(DISTINCT c.fine) k, COUNT(*) n
 FROM "values" v JOIN value_concepts c ON c.value_id=v.id JOIN units u ON u.id=v.unit_id
 WHERE v.kind='param' AND v.is_primitive=1 AND v.type LIKE '%string%' AND c.collection=0 GROUP BY u.id HAVING n>=2 AND k>=2`);
console.log(`\n## swap-risk units (>=2 string params, >=2 fine concepts): ${swap.length}; exported: ${q(`SELECT COUNT(*) c FROM units WHERE id IN (${swap.map((s) => s.id).join(",")}) AND exported>0`)[0].c}`);
const byPkg = {}; for (const s of swap) { const p = s.file.split("/")[1]; byPkg[p] = (byPkg[p] ?? 0) + 1; } console.log(JSON.stringify(byPkg));
swap.sort((a, b) => b.n - a.n || b.k - a.k);
for (const s of swap.slice(0, 22)) console.log(`${s.file.split("/src/")[1]}::${s.name} | ${s.ps}`);
const anyId = swap.filter((s) => s.n >= 2).length;
console.log("pairs of ids-with-paths etc:", q(`SELECT COUNT(*) c FROM units WHERE signature GLOB '*(*: string*: string*'`)[0].c, "units with >=2 string params (all names)");

// Argument/parameter name mismatches at resolved call sites, concept-bearing names on both sides, different fine concept.
const FINE = `(SELECT fine FROM value_concepts c JOIN "values" v ON v.id=c.value_id WHERE lower(v.name)=lower(%N) AND c.basis='name' LIMIT 1)`;
const mm = q(`SELECT ca.file, ca.line, ca.callee_name, a.param_name, a.arg_name, a.param_type, a.arg_type FROM args a JOIN calls ca ON ca.rowid=a.call_id
 WHERE a.arg_name<>a.param_name AND a.param_type LIKE '%string%' AND a.arg_type LIKE '%string%'
 AND a.param_name GLOB '*[Ii]d' AND a.arg_name GLOB '*[A-Za-z]Id' AND lower(a.param_name)<>lower(a.arg_name)`);
console.log(`\n## id-named param receiving a different *Id arg: ${mm.length}`);
for (const r of mm.slice(0, 25)) console.log(`${r.file.split("/src/")[1]}:${r.line} ${r.callee_name}(${r.param_name} <- ${r.arg_name})`);
const cross = q(`SELECT ca.file, ca.line, ca.callee_name, a.param_name, a.arg_name FROM args a JOIN calls ca ON ca.rowid=a.call_id
 WHERE a.param_type LIKE '%string%' AND a.arg_type LIKE '%string%' AND lower(a.param_name)<>lower(a.arg_name) AND (
  (a.param_name GLOB '*[Pp]ath' AND (a.arg_name GLOB '*[Ii]d' OR a.arg_name GLOB '*[Uu]rl' OR a.arg_name GLOB '*Key' OR a.arg_name GLOB '*[Dd]oi')) OR
  (a.param_name GLOB '*[Uu]rl' AND (a.arg_name GLOB '*[Pp]ath' OR a.arg_name GLOB '*[Ii]d' OR a.arg_name GLOB '*Key')) OR
  (a.param_name GLOB '*Id' AND (a.arg_name GLOB '*[Pp]ath' OR a.arg_name GLOB '*[Uu]rl' OR a.arg_name GLOB '*[Dd]ir' OR a.arg_name GLOB '*Key' OR a.arg_name GLOB '*[Dd]oi' OR a.arg_name GLOB '*Root')) OR
  (a.param_name GLOB '*[Dd]ir' AND (a.arg_name GLOB '*Id' OR a.arg_name GLOB '*[Uu]rl')) OR
  (a.param_name GLOB '*[Kk]ey' AND (a.arg_name GLOB '*Id' AND a.arg_name NOT GLOB '*[Pp]aperId' OR a.arg_name GLOB '*[Pp]ath' OR a.arg_name GLOB '*[Uu]rl')) OR
  (a.param_name GLOB '*[Dd]oi' AND (a.arg_name GLOB '*[Uu]rl' OR a.arg_name GLOB '*[Ii]d' OR a.arg_name GLOB '*[Pp]ath')))`);
console.log(`\n## cross-concept name mismatches (path/url/id/key/dir/doi): ${cross.length}`);
for (const r of cross.slice(0, 40)) console.log(`${r.file.split("/src/")[1]}:${r.line} ${r.callee_name}(${r.param_name} <- ${r.arg_name})`);
console.log("resolved call args with a name:", q(`SELECT COUNT(*) c FROM args`)[0].c);

show("escapes by kind x package", q(`SELECT e.kind, SUM(f.package='core') core, SUM(f.package='vscode') vscode, SUM(f.package='browser') browser, COUNT(*) FROM type_escapes e JOIN files f ON f.path=e.file GROUP BY 1`));
show("escapes (any,unknown,as,as-unknown-as,non-null) by core domain", q(`SELECT f.domain, SUM(e.kind='any') a, SUM(e.kind='unknown') u, SUM(e.kind='as') asx, SUM(e.kind='as-unknown-as') auu, SUM(e.kind='non-null') nn FROM type_escapes e JOIN files f ON f.path=e.file GROUP BY 1 ORDER BY (a+u+asx+auu) DESC LIMIT 16`));
show("top files by as/unknown/any", q(`SELECT substr(e.file,instr(e.file,'/src/')+5) f, SUM(e.kind='any') a, SUM(e.kind='unknown') u, SUM(e.kind IN ('as','as-unknown-as')) asx FROM type_escapes e WHERE e.kind IN ('any','unknown','as','as-unknown-as') GROUP BY e.file ORDER BY (a+u+asx) DESC LIMIT 14`));
show("escapes by runtime", q(`SELECT f.runtime, SUM(e.kind='any') a, SUM(e.kind='unknown') u, SUM(e.kind='as') asx, SUM(e.kind='as-unknown-as') auu FROM type_escapes e JOIN files f ON f.path=e.file GROUP BY 1`));
show("as targets, top", q(`SELECT substr(text,1,50) t, COUNT(*) c FROM type_escapes WHERE kind='as' GROUP BY 1 ORDER BY c DESC LIMIT 14`));
show("as-in message/parse files", q(`SELECT SUM(e.kind IN ('as','as-unknown-as')) asx, SUM(e.kind='unknown') u FROM type_escapes e WHERE e.file GLOB '*protocol*' OR e.file GLOB '*messages*' OR e.file GLOB '*parse*' OR e.file GLOB '*Guard*'`));
show("as in storage/json files", q(`SELECT SUM(e.kind IN ('as','as-unknown-as')) asx, SUM(e.kind='unknown') u FROM type_escapes e WHERE e.file GLOB '*storage*' OR e.file GLOB '*Json*' OR e.file GLOB '*json*' OR e.file GLOB '*yaml*' OR e.file GLOB '*Yaml*'`));
show("as in dom runtime files", q(`SELECT SUM(e.kind IN ('as','as-unknown-as')) asx FROM type_escapes e JOIN files f ON f.path=e.file WHERE f.runtime IN ('dom','webview','content-script')`));
show("structurally equal types (shape_hash), >=3 members, >=2 files", q(`SELECT COUNT(*) fams, SUM(c) types FROM (SELECT shape_hash, COUNT(*) c FROM types WHERE members>=3 AND kind<>'enum' GROUP BY shape_hash HAVING COUNT(*)>1 AND COUNT(DISTINCT file)>1)`));
show("equal shape groups, top", q(`SELECT GROUP_CONCAT(name||'@'||substr(file,instr(file,'/src/')+5),'  ') g FROM types WHERE members>=3 AND kind<>'enum' AND shape_hash IN (SELECT shape_hash FROM types WHERE members>=3 AND kind<>'enum' GROUP BY shape_hash HAVING COUNT(DISTINCT file)>1) GROUP BY shape_hash ORDER BY MAX(members) DESC, COUNT(*) DESC LIMIT 12`));
show("type_pairs near (not same hash), top", q(`SELECT a.name||' ~ '||b.name||' '||ROUND(p.typed_sim,2) FROM type_pairs p JOIN types a ON a.rowid=p.a JOIN types b ON b.rowid=p.b WHERE p.same_hash=0 ORDER BY p.typed_sim DESC LIMIT 8`));
