// Writes the module map from the code-facts database: .code-facts/map/index.md (every module as one line, per package
// and domain) and one detail file per domain (exports, module graph and file headers), for scouts that locate code.
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_PATH, FACTS_DIR, PACKAGES } from "./lib.mjs";

const INDEX_CAP = 24 * 1024;
const DOMAIN_CAP = 32 * 1024;
const EXPORT_CAP = 20;
const EDGE_CAP = 15;
const bytes = (text) => Buffer.byteLength(text);
const flat = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const cut = (text, max) => {
  const value = flat(text).replace(/^Exports (the )?/, "");
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
};
// Checker signatures of types carry their own JSDoc and the export keyword; neither helps a scout.
const sigOf = (text) => String(text ?? "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(export\s+)?(declare\s+)?/, "");
const slug = (domain) => (domain === "(root)" ? "root" : domain);
const detailName = (pkg, domain) => `${pkg}-${slug(domain)}.md`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Lines of `lines` joined while the total stays within `budget` bytes; the rest becomes a "… N more" line. */
function fit(lines, budget) {
  const out = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const cost = bytes(lines[i]) + 1;
    const reserve = i < lines.length - 1 ? bytes(`… ${lines.length - i - 1} more`) + 1 : 0;
    if (used + cost + reserve > budget) {
      out.push(`… ${lines.length - i} more`);
      break;
    }
    out.push(lines[i]);
    used += cost;
  }
  return out;
}

function load(db) {
  const modules = db.prepare("SELECT path, package, domain, runtime, purpose, files, lines FROM modules ORDER BY path").all();
  const exportsByModule = new Map();
  for (const row of db.prepare("SELECT module, name, kind, signature, file, line, doc FROM exports ORDER BY module, file, line, name").all()) {
    if (!exportsByModule.has(row.module)) exportsByModule.set(row.module, []);
    exportsByModule.get(row.module).push(row);
  }
  const filesByModule = new Map();
  for (const row of db.prepare("SELECT path, module, lines, header FROM files ORDER BY path").all()) {
    if (!filesByModule.has(row.module)) filesByModule.set(row.module, []);
    filesByModule.get(row.module).push(row);
  }
  const dependsOn = new Map();
  const usedBy = new Map();
  const push = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };
  for (const row of db.prepare("SELECT from_module, to_module, weight FROM module_edges WHERE from_module <> to_module ORDER BY weight DESC, from_module, to_module").all()) {
    push(dependsOn, row.from_module, { module: row.to_module, weight: row.weight });
    push(usedBy, row.to_module, { module: row.from_module, weight: row.weight });
  }
  return { modules, exportsByModule, filesByModule, dependsOn, usedBy };
}

/** Domains per package in stable order, each with its modules; the domain purpose is its own top-level module's, else a list of module names. */
function domainsOf(modules) {
  const tree = new Map();
  for (const mod of modules) {
    if (!tree.has(mod.package)) tree.set(mod.package, new Map());
    const domains = tree.get(mod.package);
    if (!domains.has(mod.domain)) domains.set(mod.domain, []);
    domains.get(mod.domain).push(mod);
  }
  const order = (pkg) => (PACKAGES.includes(pkg) ? PACKAGES.indexOf(pkg) : PACKAGES.length);
  return [...tree.entries()]
    .sort(([a], [b]) => order(a) - order(b) || byText(a, b))
    .map(([pkg, domains]) => [
      pkg,
      [...domains.entries()]
        .sort(([a], [b]) => byText(a, b))
        .map(([domain, mods]) => {
          const own = mods.find((mod) => mod.path.split("/").length === 4 && mod.purpose);
          return { domain, mods, purpose: own?.purpose ?? "" };
        }),
    ]);
}

const shortModule = (path) => path.replace(/^packages\//, "").replace("/src/", "/");
const sumFiles = (mods) => mods.reduce((n, mod) => n + mod.files, 0);

function renderIndex(structure, purposeMax) {
  const lines = [
    "# Module map",
    "Per package and domain: modules as `path — purpose (runtime, N files)`. Each domain heading names its detail file (exports, module graph, file headers) in this folder; query with `pnpm facts`.",
  ];
  for (const [pkg, domains] of structure) {
    lines.push("", `## ${pkg}`);
    for (const { domain, mods, purpose } of domains) {
      const lone = mods.length === 1 && mods[0].path.split("/").length === 4;
      lines.push(`### ${domain} (${lone ? plural(sumFiles(mods), "file") : `${plural(mods.length, "module")}, ${plural(sumFiles(mods), "file")}`}) → ${detailName(pkg, domain)}`);
      for (const mod of mods) lines.push(`${mod.path} — ${cut(mod.purpose, purposeMax) || "(no header)"} (${mod.runtime}, ${plural(mod.files, "file")})`);
    }
  }
  return lines;
}

function writeIndex(structure) {
  for (const purposeMax of [200, 160, 130, 100, 80, 60]) {
    const lines = renderIndex(structure, purposeMax);
    const text = `${lines.join("\n")}\n`;
    if (bytes(text) <= INDEX_CAP) return text;
  }
  const lines = renderIndex(structure, 60);
  return `${fit(lines, INDEX_CAP - 64).join("\n")}\n`;
}

function renderDomain(pkg, domain, mods, purpose, data, limits) {
  const lines = [`# ${pkg}/${domain}${purpose ? ` — ${cut(purpose, limits.purpose)}` : ""}`];
  for (const mod of mods) {
    lines.push("", `## ${mod.path} — ${cut(mod.purpose, limits.purpose) || "(no header)"}`, `runtime: ${mod.runtime}; ${plural(mod.files, "file")}, ${mod.lines} lines`);
    const exps = data.exportsByModule.get(mod.path) ?? [];
    if (exps.length) {
      lines.push(`exports (${exps.length}):`);
      for (const exp of exps.slice(0, EXPORT_CAP)) {
        const doc = exp.doc ? ` — ${cut(exp.doc, limits.doc)}` : "";
        lines.push(`- ${exp.file}:${exp.line} ${exp.kind} ${exp.name}: ${cut(sigOf(exp.signature), limits.signature)}${doc}`);
      }
      if (exps.length > EXPORT_CAP) lines.push(`… ${exps.length - EXPORT_CAP} more`);
    }
    for (const [label, map] of [["depends-on", data.dependsOn], ["used-by", data.usedBy]]) {
      const edges = map.get(mod.path) ?? [];
      if (!edges.length) continue;
      const shown = edges.slice(0, EDGE_CAP).map((edge) => `${shortModule(edge.module)}(${edge.weight})`);
      lines.push(`${label}: ${shown.join(", ")}${edges.length > EDGE_CAP ? `, … ${edges.length - EDGE_CAP} more` : ""}`);
    }
    const files = data.filesByModule.get(mod.path) ?? [];
    if (files.length) {
      lines.push("files:");
      for (const file of files) lines.push(`- ${file.path.slice(mod.path.length + 1)} (${file.lines}) — ${cut(file.header, limits.header) || "(no header)"}`);
    }
  }
  return lines;
}

function writeDomain(pkg, domain, mods, purpose, data) {
  const steps = [
    { purpose: 200, signature: 160, doc: 100, header: 200 },
    { purpose: 140, signature: 110, doc: 70, header: 120 },
    { purpose: 100, signature: 80, doc: 40, header: 80 },
    { purpose: 70, signature: 60, doc: 0, header: 50 },
  ];
  for (const limits of steps) {
    const text = `${renderDomain(pkg, domain, mods, purpose, data, limits).join("\n")}\n`;
    if (bytes(text) <= DOMAIN_CAP) return text;
  }
  const lines = renderDomain(pkg, domain, mods, purpose, data, steps.at(-1));
  return `${fit(lines, DOMAIN_CAP - 64).join("\n")}\n`;
}

function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`moduleMap: ${DB_PATH} does not exist; run \`pnpm facts build\` first`);
    process.exit(1);
  }
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const data = load(db);
  db.close();
  const structure = domainsOf(data.modules);

  const tmp = join(FACTS_DIR, "map.tmp");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, "index.md"), writeIndex(structure));
  for (const [pkg, domains] of structure) {
    for (const { domain, mods, purpose } of domains) writeFileSync(join(tmp, detailName(pkg, domain)), writeDomain(pkg, domain, mods, purpose, data));
  }
  const dir = join(FACTS_DIR, "map");
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
}

main();
