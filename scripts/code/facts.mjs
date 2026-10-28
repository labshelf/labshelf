// Command line over the code-facts database: build it, say where a name is defined, find code by words, find any function
// (private included) by words, by parameter and return types and calls, or by a similar snippet, and read a module, its
// callers, importers, tests and comment tags. No model is involved; every answer is capped and reported as an index_query event.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emit } from "../agents/telemetry.mjs";
import { DB_PATH, DIRTY_PATH, LOCK_PATH, ROOT, ftsQuery, jaccard, lockHeld, multisetOverlap, splitTopLevel, typeKey } from "./lib.mjs";

const CODE_DIR = dirname(fileURLToPath(import.meta.url));
const CAP = 30;
const FIND_LIMIT = 15;
const MAX_CHARS = 32000;
const MAX_TEXT = 140;
process.stdout.on("error", () => process.exit(0));
const stats = { results: 0, chars: 0 };
const out = (line) => {
  stats.chars += line.length + 1;
  process.stdout.write(`${line}\n`);
};
const clip = (text, max = MAX_TEXT) => {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

function openDb() {
  if (!existsSync(DB_PATH)) fail("no facts database; run: pnpm facts build");
  return new DatabaseSync(DB_PATH, { readOnly: true });
}

function git(...args) {
  const run = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return run.status === 0 ? run.stdout.trim() : "";
}

function warnIfStale(db) {
  const built = db.prepare("SELECT value FROM meta WHERE key = 'head_sha'").get()?.value;
  const head = git("rev-parse", "HEAD");
  if (built && head && built !== head) out(`warning: facts built at ${built.slice(0, 8)}, HEAD is ${head.slice(0, 8)}; run: pnpm facts build`);
}

/** Prints at most `cap` rows and `MAX_CHARS` characters and says how many were left out, so a long answer never floods the reader. */
function printRows(rows, format, cap = CAP) {
  if (rows.length === 0) out("(no results)");
  let printed = 0;
  let chars = 0;
  for (const row of rows.slice(0, cap)) {
    const line = format(row);
    if (printed > 0 && chars + line.length + 1 > MAX_CHARS) break;
    out(line);
    chars += line.length + 1;
    printed++;
  }
  stats.results += rows.length;
  if (rows.length > printed) out(`... ${rows.length - printed} more (narrow the query or use sql)`);
}

function parseFlags(args, valueFlags = []) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (valueFlags.includes(args[i])) flags[args[i].slice(2)] = args[++i];
    else if (args[i].startsWith("--")) flags[args[i].slice(2)] = true;
    else rest.push(args[i]);
  }
  return { flags, rest };
}

// ---------- commands ----------
/** Rebuilds the database. The edit hook leaves `.code-facts/dirty`; it is cleared before the run and, if an edit set it again meanwhile, the run is repeated once. */
function build(args) {
  const { flags } = parseFlags(args);
  const file = join(CODE_DIR, "extract.mjs");
  const extract = () => {
    const run = spawnSync(process.execPath, [file, ...(flags.quiet ? ["--quiet"] : [])], { cwd: ROOT, stdio: flags.quiet ? "ignore" : "inherit" });
    if (run.status !== 0) fail(`extract.mjs failed (exit ${run.status})`);
  };
  // While another build runs, its marker stays: that build repeats itself at the end when the marker is there.
  const owner = !lockHeld(LOCK_PATH);
  if (owner) rmSync(DIRTY_PATH, { force: true });
  extract();
  if (owner && existsSync(DIRTY_PATH)) {
    rmSync(DIRTY_PATH, { force: true });
    extract();
  }
}

// Export and unit rows already carry "path:line" as their ref; files and modules point at the top.
const locationOf = (ref) => (/:\d+$/.test(ref) ? ref : `${ref}:1`);

const ftsRows = (db, words, limit) => {
  const query = ftsQuery(words);
  if (!query) return [];
  // A declaration re-exported by several modules has one row per module but one location.
  const rows = db
    .prepare("SELECT kind, ref, name, body FROM search_fts WHERE search_fts MATCH ? ORDER BY bm25(search_fts, 0, 0, 4, 2, 1) LIMIT ?")
    .all(query, limit * 2);
  const seen = new Set();
  return rows.filter((row) => !seen.has(`${row.kind}\0${row.ref}\0${row.name}`) && seen.add(`${row.kind}\0${row.ref}\0${row.name}`)).slice(0, limit);
};
const formatHit = (row) => `${locationOf(row.ref)} ${row.kind} ${row.name} — ${clip(row.body)}`;

function find(db, args) {
  if (!ftsQuery(args.join(" "))) fail('usage: facts find "<words>"');
  printRows(ftsRows(db, args.join(" "), FIND_LIMIT), formatHit, FIND_LIMIT);
}

/** Where a name is defined: units by name or `Owner.method`, exported declarations by export name, and the re-exports of it. */
function def(db, args) {
  const name = args[0];
  if (!name) fail("usage: facts def <name>");
  const units = db
    .prepare("SELECT * FROM units WHERE name = ? OR (owner <> '' AND owner || '.' || name = ?) ORDER BY file, start_line")
    .all(name, name);
  const rows = units.map((unit) => ({ file: unit.file, line: unit.start_line, text: `${unit.kind} ${labelOf(unit)} ${clip(unit.signature, 110)} (${visibilityOf(unit)})` }));
  const unitFiles = new Set(units.map((unit) => `${unit.file}\0${unit.name}`));
  const seen = new Set();
  for (const item of db.prepare("SELECT name, kind, signature, file, line FROM exports WHERE name = ? ORDER BY file, line").all(name)) {
    const key = `${item.file}:${item.line}`;
    if (seen.has(key) || unitFiles.has(`${item.file}\0${item.name}`)) continue;
    seen.add(key);
    rows.push({ file: item.file, line: item.line, text: `${item.kind} ${item.name} ${clip(item.signature, 110)} (exported)` });
  }
  for (const item of db.prepare("SELECT file, line, from_file FROM reexports WHERE name = ? ORDER BY file, line").all(name))
    rows.push({ file: item.file, line: item.line, text: `re-export of ${item.from_file}` });
  printRows(rows, (row) => `${row.file}:${row.line} ${row.text}`.replace(/ {2,}/g, " "));
}

// ---------- functions: by words, by structure, by similar code ----------
const FN_LIMIT = 12;
const SIG_LIMIT = 15;
const SIMILAR_LIMIT = 10;
const SIMILAR_MIN_NODES = 10;
const labelOf = (unit) => (unit.owner ? `${unit.owner}.${unit.name}` : unit.name);
const visibilityOf = (unit) => (unit.exported ? "exported" : "private");
const unitLine = (unit) => `${unit.file}:${unit.start_line} ${labelOf(unit)} ${clip(unit.signature, 110)}`;

/** Every unit, private helpers included, by words matched against its name, types, calls, comment, strings and file header. */
function fn(db, args) {
  const { flags, rest } = parseFlags(args);
  const query = ftsQuery(rest.join(" "));
  if (!query) fail('usage: facts fn "<words>" [--private]');
  const rows = db
    .prepare(
      `SELECT u.*, f.header FROM unit_fts JOIN units u ON u.id = unit_fts.unit_id LEFT JOIN files f ON f.path = u.file
       WHERE unit_fts MATCH ? ${flags.private ? "AND u.exported = 0" : ""} ORDER BY bm25(unit_fts, 0, 5, 1, 1.5, 2, 0.5) LIMIT ?`,
    )
    .all(query, FN_LIMIT);
  printRows(rows, (unit) => `${unitLine(unit)} — ${clip(unit.header, 100)} (${visibilityOf(unit)})`, FN_LIMIT);
}

const unitFactRows = (db, where = "") =>
  db
    .prepare(`SELECT u.*, uf.nodes, uf.t1, uf.t2, uf.body_t1, uf.body_t2, uf.shingles, uf.params, uf.returns, uf.calls FROM units u JOIN unit_facts uf ON uf.id = u.id ${where}`)
    .all();

/** Units ranked by how many of the wanted parameter types (any order), return type and called names they have. */
function sig(db, args) {
  const { flags } = parseFlags(args, ["--params", "--returns", "--calls"]);
  if (!flags.params && !flags.returns && !flags.calls) fail('usage: facts sig [--params "<type,type>"] [--returns "<type>"] [--calls a,b]');
  const params = flags.params ? splitTopLevel(flags.params).map(typeKey) : [];
  const returns = flags.returns ? typeKey(flags.returns) : "";
  const calls = flags.calls ? flags.calls.split(",").map((name) => name.trim()).filter(Boolean) : [];
  const wanted = params.length + (returns ? 1 : 0) + calls.length;
  const scored = [];
  for (const unit of unitFactRows(db)) {
    const have = JSON.parse(unit.params);
    const called = new Set(JSON.parse(unit.calls));
    const score = multisetOverlap(params, have) + (returns && unit.returns === returns ? 1 : 0) + calls.filter((name) => called.has(name)).length;
    if (score > 0) scored.push({ unit, score, extra: Math.abs(have.length - params.length) });
  }
  scored.sort((a, b) => b.score - a.score || a.extra - b.extra || a.unit.signature.length - b.unit.signature.length);
  printRows(scored, ({ unit, score }) => `${score}/${wanted} ${unitLine(unit)} (${visibilityOf(unit)})`, SIG_LIMIT);
}

const shinglesOf = (blob) => (blob ? new Uint32Array(new Uint8Array(blob).buffer) : new Uint32Array());

/** Units whose normalized code is closest to a snippet on stdin (`-`) or a line range: 4-shingle Jaccard plus exact T1/T2 hits. */
async function similar(db, args) {
  const { flags, rest } = parseFlags(args, ["--file", "--lines"]);
  let print;
  let selfId;
  let text;
  if (flags.file && flags.lines) {
    const [start, end] = flags.lines.split("-").map(Number);
    const self = db.prepare("SELECT uf.* FROM units u JOIN unit_facts uf ON uf.id = u.id WHERE u.file = ? AND u.start_line = ? AND u.end_line = ?").get(flags.file, start, end || start);
    if (self?.t1) {
      selfId = self.id;
      print = { t1: self.t1, t2: self.t2, bodyT1: self.body_t1, bodyT2: self.body_t2, shingles: shinglesOf(self.shingles) };
    } else text = readFileSync(join(ROOT, flags.file), "utf8").split("\n").slice(start - 1, end || start).join("\n");
  } else if (rest[0] === "-") text = readFileSync(0, "utf8");
  else fail("usage: facts similar - (snippet on stdin) | facts similar --file <path> --lines a-b");
  if (!print) {
    const { snippetFingerprint } = await import("./tokens.mjs");
    const uses = new Map(db.prepare("SELECT name, local_n, free_n FROM idents").all().map((row) => [row.name, row]));
    // A name the snippet uses without declaring is local unless the codebase mostly uses it as a free (imported or global) name.
    print = snippetFingerprint(text, (name) => !uses.has(name) || uses.get(name).local_n >= uses.get(name).free_n);
  }
  const hits = [];
  for (const unit of unitFactRows(db, `WHERE uf.nodes >= ${SIMILAR_MIN_NODES}`)) {
    if (unit.id === selfId) continue;
    const exact =
      unit.t1 === print.t1 || unit.body_t1 === print.bodyT1 ? "T1" : unit.t2 === print.t2 || unit.body_t2 === print.bodyT2 ? "T2" : "";
    const similarity = jaccard(print.shingles, shinglesOf(unit.shingles));
    if (exact || similarity > 0) hits.push({ unit, exact, similarity });
  }
  hits.sort((a, b) => Number(Boolean(b.exact)) - Number(Boolean(a.exact)) || b.similarity - a.similarity);
  printRows(hits, ({ unit, exact, similarity }) => `${similarity.toFixed(2)}${exact ? ` ${exact}` : ""} ${unitLine(unit)} (${visibilityOf(unit)})`, SIMILAR_LIMIT);
}

function findModules(db, target) {
  const clean = target.replace(/\/+$/, "");
  const exact = db.prepare("SELECT * FROM modules WHERE path = ?").all(clean);
  if (exact.length) return exact;
  return db.prepare("SELECT * FROM modules WHERE path LIKE ? ORDER BY path").all(`%/${clean}`);
}

function moduleCommand(db, args) {
  const target = args[0];
  if (!target) fail("usage: facts module <path-or-name>");
  const found = findModules(db, target);
  if (found.length === 0) fail(`no module matches ${target}`);
  if (found.length > 1) {
    out(`ambiguous: ${found.length} modules match ${target}`);
    printRows(found, (mod) => `${mod.path}:1 ${mod.runtime} — ${clip(mod.purpose)}`);
    return;
  }
  const mod = found[0];
  out(`${mod.path}:1 ${mod.runtime}, ${mod.files} files, ${mod.lines} lines — ${clip(mod.purpose, 300)}`);
  out("exports:");
  const exports = db.prepare("SELECT name, kind, signature, file, line FROM exports WHERE module = ? ORDER BY file, line").all(mod.path);
  printRows(exports, (item) => `${item.file}:${item.line} ${item.kind} ${item.name}${item.signature ? ` ${clip(item.signature, 110)}` : ""}`);
  const edge = (column, other) =>
    db.prepare(`SELECT ${other} AS module, weight FROM module_edges WHERE ${column} = ? AND ${other} <> ? ORDER BY weight DESC`).all(mod.path, mod.path);
  out("depends on:");
  printRows(edge("from_module", "to_module"), (item) => `${item.module}:1 weight ${item.weight}`);
  out("used by:");
  printRows(edge("to_module", "from_module"), (item) => `${item.module}:1 weight ${item.weight}`);
  out("files:");
  printRows(db.prepare("SELECT path, lines, header FROM files WHERE module = ? ORDER BY path").all(mod.path), (file) => `${file.path}:1 ${file.lines}L ${clip(file.header)}`);
}

function callers(db, args) {
  const { flags, rest } = parseFlags(args, ["--file"]);
  const name = rest[0];
  if (!name) fail("usage: facts callers <name> [--file <path>]");
  const sql = `SELECT c.file, c.line, caller.name AS caller, caller.owner AS owner, callee.file AS target
    FROM calls c LEFT JOIN units caller ON caller.id = c.caller_id LEFT JOIN units callee ON callee.id = c.callee_id
    WHERE c.callee_name = ? ${flags.file ? "AND callee.file = ?" : ""} ORDER BY c.file, c.line`;
  const rows = db.prepare(sql).all(...(flags.file ? [name, flags.file] : [name]));
  printRows(rows, (row) => `${row.file}:${row.line} ${row.owner ? `${row.owner}.` : ""}${row.caller ?? "(top level)"} -> ${name}${row.target ? ` (${row.target})` : ""}`);
}

function uses(db, args) {
  const file = args[0];
  if (!file) fail("usage: facts uses <file>");
  out("imports:");
  printRows(db.prepare("SELECT to_file, names FROM file_edges WHERE from_file = ? ORDER BY to_file").all(file), (row) => `${row.to_file}:1 ${clip(row.names, 100)}`);
  out("imported by:");
  printRows(db.prepare("SELECT from_file, names FROM file_edges WHERE to_file = ? ORDER BY from_file").all(file), (row) => `${row.from_file}:1 ${clip(row.names, 100)}`);
}

function testsCommand(db, args) {
  const file = args[0];
  if (!file) fail("usage: facts tests <file>");
  const rows = db.prepare("SELECT test_file, source_file, how FROM tests WHERE source_file = ? OR test_file = ? ORDER BY test_file, source_file").all(file, file);
  printRows(rows, (row) => `${row.test_file}:1 covers ${row.source_file} (${row.how})`);
}

function tagsCommand(db, args) {
  const prefix = args[0] ?? "";
  const rows = db.prepare("SELECT file, line, tag, text FROM tags WHERE file LIKE ? ORDER BY file, line").all(`${prefix}%`);
  printRows(rows, (row) => `${row.file}:${row.line} ${row.tag} ${clip(row.text)}`);
}

function sql(db, args) {
  const statement = args.join(" ").trim();
  if (!/^(select|with)\b/i.test(statement)) fail("sql accepts a single SELECT");
  db.exec("PRAGMA query_only = ON");
  const rows = db.prepare(statement).all();
  printRows(rows, (row) => Object.values(row).map((value) => clip(value, 120)).join(" | "));
}

// Commands that need the database get it opened and checked for staleness first.
const COMMANDS = { build, def, find, fn, sig, similar, module: moduleCommand, callers, uses, tests: testsCommand, tags: tagsCommand, sql };

const [command, ...args] = process.argv.slice(2);
if (!command || !Object.hasOwn(COMMANDS, command)) fail(`usage: facts <${Object.keys(COMMANDS).join("|")}> ...`);
if (command === "build") COMMANDS.build(args);
else {
  const db = openDb();
  warnIfStale(db);
  await COMMANDS[command](db, args);
  emit("index_query", { query_kind: command, results: stats.results, chars: stats.chars });
}
