// Moves files or folders with `git mv` and rewrites every relative import, re-export, dynamic import() and jest.mock() path.
// Usage: node scripts/codemods/moveFiles.mjs moves.tsv [--dry-run] [--root <dir>]   (TSV lines: oldPath<TAB>newPath)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CODE_EXTENSIONS, listFiles, parseArgs, ts } from "./shared.mjs";

const SCAN_FOLDERS = ["packages", "website"];
const MOCK_CALLS = new Set(["mock", "doMock", "unmock", "dontMock", "requireActual", "requireMock", "createMockFromModule", "setMock"]);
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css"];
const JS_TO_TS = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };
const CONFIG_FILE = /(^|\/)(package\.json|tsconfig[^/]*\.json|jest\.config\.[cm]?js|knip\.json|jscpd\.json|dependencyCruiser\.cjs)$/;

const toPosix = (path) => path.split(sep).join("/");
const isCode = (file) => CODE_EXTENSIONS.includes(extname(file));
const isTestable = (file) => /^packages\/[^/]+\/src\//.test(file);

function scriptKind(file) {
  const ext = extname(file);
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  return [".js", ".mjs", ".cjs"].includes(ext) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

/** Module specifier string literals in a source file, as {start, end, text} (offsets exclude the quotes). */
export function findSpecifiers(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const found = [];
  const add = (node) => {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      found.push({ start: node.getStart(source) + 1, end: node.end - 1, text: node.text });
    }
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) add(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      const isMock =
        ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "jest" && MOCK_CALLS.has(callee.name.text);
      if (isImport || isRequire || isMock) add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const CSS_REFERENCE = /(@import\s+(?:url\()?\s*|url\(\s*)(["']?)(\.{1,2}\/[^"')\s;]+)\2/g;

function findCssSpecifiers(text) {
  const found = [];
  for (const match of text.matchAll(CSS_REFERENCE)) {
    const start = match.index + match[1].length + match[2].length;
    found.push({ start, end: start + match[3].length, text: match[3] });
  }
  return found;
}

/** Resolves a relative specifier written in `fromFile` (absolute) to an existing file and the form it used. */
export function resolveSpecifier(fromFile, specifier) {
  const bare = specifier.replace(/[?#].*$/, "");
  const suffix = specifier.slice(bare.length);
  const base = resolve(dirname(fromFile), bare);
  const isFile = (path) => existsSync(path) && statSync(path).isFile();
  if (isFile(base)) return { file: base, form: "exact", suffix };
  const ext = extname(base);
  for (const tsExt of JS_TO_TS[ext] ?? []) {
    const candidate = base.slice(0, -ext.length) + tsExt;
    if (isFile(candidate)) return { file: candidate, form: "jsExt", ext, suffix };
  }
  for (const tryExt of RESOLVE_EXTENSIONS) if (isFile(base + tryExt)) return { file: base + tryExt, form: "bare", suffix };
  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const tryExt of RESOLVE_EXTENSIONS) if (isFile(join(base, "index" + tryExt))) return { file: join(base, "index" + tryExt), form: "dir", suffix };
  }
  return null;
}

const stripExtension = (file) => (file.endsWith(".d.ts") ? file.slice(0, -5) : file.slice(0, file.length - extname(file).length));

/** The specifier to write in `newFrom` so that it keeps pointing at `newTarget` in the same style as before. */
function formatSpecifier(original, resolved, newFrom, newTarget) {
  const fromDir = dirname(newFrom);
  let form = resolved.form;
  let path;
  if (form === "dir" && !basename(newTarget).startsWith("index.")) form = "bare";
  if (form === "dir") path = toPosix(relative(fromDir, dirname(newTarget)));
  else if (form === "exact") path = toPosix(relative(fromDir, newTarget));
  else if (form === "jsExt") path = toPosix(relative(fromDir, stripExtension(newTarget))) + resolved.ext;
  else path = toPosix(relative(fromDir, stripExtension(newTarget)));
  if (path === "") path = ".";
  if (!path.startsWith(".")) path = "./" + path;
  if (original.endsWith("/") && !path.endsWith("/")) path += "/";
  return path + resolved.suffix;
}

function readMoves(tsvPath) {
  return readFileSync(tsvPath, "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const [from, to] = line.split("\t").map((part) => toPosix(part.trim()).replace(/\/+$/, ""));
      if (!from || !to) throw new Error(`Bad TSV line (need oldPath<TAB>newPath): ${line}`);
      return [from, to];
    });
}

/** Expands folder entries and adds mirrored tests; returns a Map of repo-relative old path -> new path. */
function planMoves(root, entries, tracked) {
  const plan = new Map();
  const put = (from, to) => {
    if (plan.has(from) && plan.get(from) !== to) throw new Error(`${from} is moved twice`);
    plan.set(from, to);
  };
  const filesUnder = (folder) => tracked.filter((file) => file.startsWith(folder + "/"));
  for (const [from, to] of entries) {
    const abs = join(root, from);
    if (!existsSync(abs)) throw new Error(`Source does not exist: ${from}`);
    if (statSync(abs).isDirectory()) {
      for (const file of filesUnder(from)) put(file, to + file.slice(from.length));
      const mirror = /^packages\/([^/]+)\/src\/(.+)$/.exec(from);
      const newMirror = /^packages\/([^/]+)\/src\/(.+)$/.exec(to);
      if (mirror && newMirror) {
        const oldTests = `packages/${mirror[1]}/__tests__/${mirror[2]}`;
        const newTests = `packages/${newMirror[1]}/__tests__/${newMirror[2]}`;
        for (const file of filesUnder(oldTests)) put(file, newTests + file.slice(oldTests.length));
      }
    } else {
      put(from, to);
    }
  }
  for (const [from, to] of [...plan]) {
    const oldMatch = /^packages\/([^/]+)\/src\/(.+)\.(tsx?)$/.exec(from);
    const newMatch = /^packages\/([^/]+)\/src\/(.+)\.(tsx?)$/.exec(to);
    if (!isTestable(from) || !oldMatch || !newMatch) continue;
    for (const testExt of ["ts", "tsx"]) {
      const oldTest = `packages/${oldMatch[1]}/__tests__/${oldMatch[2]}.test.${testExt}`;
      if (tracked.includes(oldTest) && !plan.has(oldTest)) put(oldTest, `packages/${newMatch[1]}/__tests__/${newMatch[2]}.test.${testExt}`);
    }
  }
  return plan;
}

function validate(root, plan) {
  const targets = new Set();
  for (const [from, to] of plan) {
    if (from === to) throw new Error(`${from} is moved onto itself`);
    if (targets.has(to)) throw new Error(`Two files move to ${to}`);
    targets.add(to);
    if (existsSync(join(root, to)) && !plan.has(to)) throw new Error(`Destination already exists: ${to}`);
  }
}

function applyEdits(text, edits) {
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  return out;
}

/** Returns Map<repo-relative old path, new content> for every scanned file whose specifiers change. */
function planRewrites(root, plan, scanFiles) {
  const absPlan = new Map([...plan].map(([from, to]) => [join(root, from), join(root, to)]));
  const rewritten = new Map();
  for (const file of scanFiles) {
    const abs = join(root, file);
    const isCss = extname(file) === ".css";
    if (!isCss && !isCode(file)) continue;
    const text = readFileSync(abs, "utf8");
    const specifiers = isCss ? findCssSpecifiers(text) : findSpecifiers(file, text);
    const newFrom = absPlan.get(abs) ?? abs;
    const edits = [];
    for (const specifier of specifiers) {
      if (!specifier.text.startsWith(".")) continue;
      const resolved = resolveSpecifier(abs, specifier.text);
      if (!resolved) continue;
      const newTarget = absPlan.get(resolved.file) ?? resolved.file;
      if (newFrom === abs && newTarget === resolved.file) continue;
      const replacement = formatSpecifier(specifier.text, resolved, newFrom, newTarget);
      if (replacement !== specifier.text) edits.push({ ...specifier, replacement });
    }
    if (edits.length > 0) rewritten.set(file, applyEdits(text, edits));
  }
  return rewritten;
}

function removeEmptyFolders(root, file) {
  let dir = dirname(join(root, file));
  while (dir.startsWith(join(root, "packages") + sep) || dir.startsWith(join(root, "website") + sep)) {
    if (!existsSync(dir) || readdirSync(dir).length > 0) return;
    rmdirSync(dir);
    dir = dirname(dir);
  }
}

const packageOf = (file) => /^packages\/([^/]+)\//.exec(file)?.[1];
// Code under src/ and __tests__/ gets its imports rewritten already; only its odd string paths remain, so they are not reported.
const isRewrittenCode = (file) => /^packages\/[^/]+\/(src|__tests__)\//.test(file) && isCode(file);

/**
 * Needles per moved path: the full path (`packages/core/src/bridge`, matches anywhere), the sibling form
 * (`core/src/bridge`, as build scripts write `../core/src/bridge`; matches anywhere outside rewritten code) and the
 * package-relative form (`src/bridge`; matches only files of the same package and root configs such as knip.json).
 */
function needlesFor(entries, folders) {
  const needles = [];
  for (const [from] of entries) {
    const base = folders.has(from) ? from : stripExtension(from);
    const parts = /^packages\/([^/]+)\/(.+)$/.exec(base);
    needles.push({ text: base, pkg: null, rewrittenCodeToo: true });
    if (!parts) continue;
    needles.push({ text: `${parts[1]}/${parts[2]}`, pkg: null, rewrittenCodeToo: false });
    needles.push({ text: parts[2], pkg: parts[1], rewrittenCodeToo: false });
  }
  return needles;
}

/** True when `content` mentions the package-relative needle other than as `<otherPackage>/<needle>`. */
function mentionsOwnPath(needle, content, packages) {
  const others = packages.filter((name) => name !== needle.pkg).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const foreign = others.length === 0 ? null : new RegExp(`(${others.join("|")})/$`);
  for (let at = content.indexOf(needle.text); at !== -1; at = content.indexOf(needle.text, at + 1)) {
    if (!foreign || !foreign.test(content.slice(0, at))) return true;
  }
  return false;
}

function wantsHit(needle, file, content, packages) {
  if (!needle.rewrittenCodeToo && isRewrittenCode(file)) return false;
  if (needle.pkg !== null && !mentionsOwnPath(needle, content, packages)) return false;
  if (needle.pkg === null) return true;
  const filePackage = packageOf(file);
  if (filePackage) return filePackage === needle.pkg;
  return CONFIG_FILE.test(file) && !file.startsWith("website/");
}

/** Files that still mention an old path after the move: configs, build scripts, docs and odd string paths. */
function findLeftovers(root, entries, folders, plan, rewritten) {
  const skip = new Set([...rewritten.keys()].map((file) => plan.get(file) ?? file).filter(isRewrittenCode));
  const hits = new Map();
  const packages = existsSync(join(root, "packages")) ? readdirSync(join(root, "packages")) : [];
  for (const needle of needlesFor(entries, folders)) {
    let output = "";
    try {
      output = execFileSync("git", ["grep", "-n", "-I", "-F", "-e", needle.text, "--", ".", ":!pnpm-lock.yaml"], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
    } catch {
      continue; // git grep exits 1 when nothing matches
    }
    for (const line of output.split("\n").filter(Boolean)) {
      const [file, , ...rest] = line.split(":");
      if (!skip.has(file) && wantsHit(needle, file, rest.join(":"), packages)) hits.set(line, true);
    }
  }
  return [...hits.keys()];
}

/** Moves files and folders and rewrites references. `moves` is an array of [oldPath, newPath], repo-relative. */
export function moveFiles({ root, moves, dryRun = false, log = console.log }) {
  const tracked = listFiles(root, ["."]);
  const folders = new Set(moves.filter(([from]) => existsSync(join(root, from)) && statSync(join(root, from)).isDirectory()).map(([from]) => from));
  const plan = planMoves(root, moves, tracked);
  validate(root, plan);
  const rewritten = planRewrites(root, plan, listFiles(root, SCAN_FOLDERS));

  log(`${plan.size} files to move, ${rewritten.size} files with rewritten references`);
  if (dryRun) {
    for (const [from, to] of plan) log(`  mv ${from} -> ${to}`);
    for (const file of rewritten.keys()) log(`  rewrite ${plan.get(file) ?? file}`);
    return { plan, rewritten, leftovers: [] };
  }

  for (const [from, to] of plan) {
    mkdirSync(dirname(join(root, to)), { recursive: true });
    try {
      execFileSync("git", ["mv", from, to], { cwd: root, stdio: "pipe" });
    } catch {
      renameSync(join(root, from), join(root, to)); // untracked files are not known to git mv
    }
  }
  for (const [file, text] of rewritten) writeFileSync(join(root, plan.get(file) ?? file), text);
  for (const from of plan.keys()) removeEmptyFolders(root, from);

  const leftovers = findLeftovers(root, moves, folders, plan, rewritten);
  if (leftovers.length > 0) {
    log("References not rewritten (package.json exports, tsconfig, jest and tool configs, scripts, docs) - fix by hand:");
    for (const line of leftovers) log(`  ${line}`);
  }
  return { plan, rewritten, leftovers };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { positional, options } = parseArgs(process.argv.slice(2));
  if (positional.length !== 1) {
    console.error("Usage: node scripts/codemods/moveFiles.mjs moves.tsv [--dry-run] [--root <dir>]");
    process.exit(2);
  }
  try {
    moveFiles({ root: options.root, moves: readMoves(resolve(positional[0])), dryRun: options.dryRun });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
