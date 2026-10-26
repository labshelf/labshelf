// Builds analysis/labshelf.db: files, dirs, units, calls, imports, types, values and type escapes for the product
// code of packages/core, packages/vscode and packages/browser, from one TypeScript program over all three packages.
// Run: node analysis/scripts/extract.mjs   (then clones.mjs and communities.mjs)
import { createHash } from "node:crypto";
import { readdirSync, rmSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_PATH, ROOT, isPropertyNamePosition, isUnitNode, loadTypeScript, localNames, tokenStream } from "./lib.mjs";

const PACKAGES = ["core", "vscode", "browser"];
const ts = loadTypeScript();

// ---------- file discovery ----------
function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(ts|tsx|mts)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
}
const rootFiles = [];
for (const pkg of PACKAGES) walk(join(ROOT, "packages", pkg, "src"), rootFiles);

const rel = (abs) => relative(ROOT, abs).split("\\").join("/");
const pkgOf = (r) => r.split("/")[1];
const domainOf = (r) => {
  const parts = r.split("/");
  return parts.length > 4 ? `${parts[1]}/${parts[3]}` : `${parts[1]}/(root)`;
};
function runtimeOf(r) {
  const segs = r.split("/");
  const pkg = segs[1];
  const inner = segs.slice(3, -1);
  if (pkg === "core") {
    if (r.includes("/relay/worker/")) return "worker";
    if (inner.includes("node")) return "node";
    if (inner.includes("dom")) return "dom";
    return "neutral";
  }
  if (pkg === "vscode") {
    if (inner.includes("node") || r.endsWith("src/extension.ts")) return "node";
    if (inner.includes("webview") || r.endsWith("webviewGlobals.d.ts")) return "webview";
    return "vscode-host";
  }
  if (segs[3] === "background") return "worker";
  if (segs[3] === "content") return "content-script";
  return "dom";
}

// ---------- program ----------
const typeRoots = PACKAGES.map((p) => join(ROOT, "packages", p, "node_modules", "@types")).filter(existsSync);
const program = ts.createProgram({
  rootNames: rootFiles,
  options: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    allowImportingTsExtensions: true,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    typeRoots,
    types: ["node", "vscode", "webextension-polyfill"],
  },
});
const checker = program.getTypeChecker();
const rootSet = new Set(rootFiles.map((f) => resolve(f)));
const sourceFiles = program.getSourceFiles().filter((sf) => rootSet.has(resolve(sf.fileName)));
console.log(`program: ${sourceFiles.length} product files`);

// ---------- db ----------
if (existsSync(DB_PATH)) rmSync(DB_PATH);
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;
CREATE TABLE files (path TEXT PRIMARY KEY, package TEXT, domain TEXT, dir TEXT, name TEXT, lines INTEGER, units INTEGER,
  exported_units INTEGER, runtime TEXT, is_barrel INTEGER, fan_in INTEGER, fan_out INTEGER);
CREATE TABLE dirs (path TEXT PRIMARY KEY, package TEXT, depth INTEGER, files INTEGER, subdirs INTEGER, lines INTEGER,
  files_recursive INTEGER, lines_recursive INTEGER, median_file_lines REAL);
CREATE TABLE units (id INTEGER PRIMARY KEY, file TEXT, name TEXT, kind TEXT, owner TEXT, context TEXT, exported INTEGER,
  start_line INTEGER, end_line INTEGER, lines INTEGER, nodes INTEGER, statements INTEGER, parent_id INTEGER,
  signature TEXT, return_type TEXT, param_count INTEGER, calls TEXT, imports_used TEXT, effects TEXT,
  t1 TEXT, t2 TEXT);
CREATE TABLE params (unit_id INTEGER, idx INTEGER, name TEXT, type TEXT, declared_type TEXT, optional INTEGER);
CREATE TABLE calls (id INTEGER PRIMARY KEY, caller_id INTEGER, callee_id INTEGER, callee_name TEXT, callee_file TEXT,
  callee_kind TEXT, receiver_type TEXT, file TEXT, line INTEGER, is_new INTEGER);
CREATE TABLE args (call_id INTEGER, idx INTEGER, param_name TEXT, param_type TEXT, arg_name TEXT, arg_text TEXT, arg_type TEXT);
CREATE TABLE imports (from_file TEXT, specifier TEXT, to_file TEXT, external TEXT, kind TEXT, type_only INTEGER, names TEXT, line INTEGER);
CREATE TABLE import_names (from_file TEXT, local TEXT, imported TEXT, via_file TEXT, decl_file TEXT, decl_kind TEXT, type_only INTEGER);
CREATE TABLE types (id INTEGER PRIMARY KEY, name TEXT, file TEXT, kind TEXT, exported INTEGER, line INTEGER, members INTEGER,
  member_names TEXT, shape TEXT, shape_hash TEXT, generic INTEGER);
CREATE TABLE "values" (id INTEGER PRIMARY KEY, name TEXT, concept TEXT, kind TEXT, owner TEXT, file TEXT, package TEXT,
  line INTEGER, type TEXT, declared_type TEXT, is_primitive INTEGER, unit_id INTEGER);
CREATE TABLE type_escapes (file TEXT, line INTEGER, kind TEXT, text TEXT, unit_id INTEGER);
`);

const sha = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
const TYPE_FLAGS = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;
const typeStr = (t, at) => {
  try {
    return checker.typeToString(t, at, TYPE_FLAGS);
  } catch {
    return "?";
  }
};
const short = (s, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s);

// ---------- concepts ----------
const CONCEPT_RE =
  /^(id|ids|path|paths|url|urls|uri|uris|key|keys|doi|dois|hash|dir|root|file|slug|token|sha|etag|rev|email|arxiv|isbn)$|(Id|Ids|ID|Path|Paths|Url|Urls|URL|Uri|Uris|Key|Keys|Doi|DOI|Hash|Dir|Dirs|Root|Folder|File|Name|Slug|Token|Sha|Etag|Rev|Revision|Email|Arxiv|Isbn)$/;
function conceptOf(name) {
  const m = CONCEPT_RE.exec(name);
  if (!m) return null;
  return (m[1] ?? m[2]).toLowerCase().replace(/s$/, "").replace(/^ur[li]$/, "url");
}

// ---------- effects ----------
const MODULE_EFFECTS = [
  [/^(node:)?fs(\/promises)?$/, "fs"],
  [/^(node:)?child_process$/, "spawn"],
  [/^(node:)?(net|http|https|tls|dgram)$/, "net"],
  [/^(node:)?os$/, "os"],
  [/^(node:)?(path)$/, "node-path"],
  [/^(node:)?(crypto)$/, "node-crypto"],
  [/^(node:)?sqlite$/, "sqlite"],
  [/^vscode$/, "vscode"],
  [/^webextension-polyfill$/, "browser-ext"],
];
const GLOBAL_EFFECTS = new Map(
  Object.entries({
    fetch: "net", XMLHttpRequest: "net", WebSocket: "net", EventSource: "net",
    document: "dom", window: "dom", navigator: "dom", getComputedStyle: "dom", requestAnimationFrame: "dom",
    MutationObserver: "dom", ResizeObserver: "dom", IntersectionObserver: "dom",
    localStorage: "storage", sessionStorage: "storage", indexedDB: "storage", caches: "storage",
    chrome: "browser-ext", browser: "browser-ext",
    process: "process", setTimeout: "timer", setInterval: "timer", queueMicrotask: "timer",
    console: "console", Date: "clock", performance: "clock", Worker: "worker", postMessage: "message",
    acquireVsCodeApi: "vscode-webview",
  }),
);

// ---------- AST helpers ----------
function propName(n) {
  if (!n) return undefined;
  if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
  if (ts.isComputedPropertyName(n)) return `[${n.expression.getText()}]`;
  return undefined;
}
function ownerName(n) {
  // class name or object-literal variable name for methods
  const p = n.parent;
  if (p && (ts.isClassDeclaration(p) || ts.isClassExpression(p))) return p.name?.text ?? "<class>";
  if (p && ts.isObjectLiteralExpression(p)) {
    const pp = p.parent;
    if (pp && ts.isVariableDeclaration(pp) && ts.isIdentifier(pp.name)) return pp.name.text;
    if (pp && ts.isPropertyAssignment(pp)) return propName(pp.name) ?? "<obj>";
    if (pp && ts.isReturnStatement(pp)) return "<return>";
    return "<obj>";
  }
  return undefined;
}
function unitName(n, sf) {
  const pos = sf.getLineAndCharacterOfPosition(n.getStart(sf));
  const anon = `<anon>@${pos.line + 1}:${pos.character + 1}`;
  if (ts.isFunctionDeclaration(n)) return { name: n.name?.text ?? "default", kind: "function" };
  if (ts.isConstructorDeclaration(n)) return { name: "constructor", owner: ownerName(n), kind: "constructor" };
  if (ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) {
    const kind = ts.isMethodDeclaration(n) ? "method" : ts.isGetAccessorDeclaration(n) ? "getter" : "setter";
    return { name: propName(n.name) ?? anon, owner: ownerName(n), kind };
  }
  const kind = ts.isArrowFunction(n) ? "arrow" : "function-expr";
  let p = n.parent;
  while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p))) p = p.parent;
  if (ts.isFunctionExpression(n) && n.name) return { name: n.name.text, kind };
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return { name: p.name.text, kind };
  if (p && ts.isPropertyAssignment(p)) return { name: propName(p.name) ?? anon, owner: ownerName(p), kind };
  if (p && ts.isPropertyDeclaration(p)) return { name: propName(p.name) ?? anon, owner: ownerName(p), kind };
  if (p && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken)
    return { name: short(p.left.getText(sf), 40), kind };
  if (p && ts.isCallExpression(p) || p && ts.isNewExpression(p)) {
    const callee = short(p.expression.getText(sf).replace(/\s+/g, ""), 40);
    return { name: anon, kind, context: `arg of ${callee}` };
  }
  return { name: anon, kind };
}

function exportedNames(sf) {
  const sym = checker.getSymbolAtLocation(sf);
  const set = new Set();
  if (!sym) return set;
  for (const e of checker.getExportsOfModule(sym)) {
    for (const d of e.declarations ?? []) if (d.getSourceFile() === sf) set.add(d);
    if (e.flags & ts.SymbolFlags.Alias) {
      try {
        const t = checker.getAliasedSymbol(e);
        for (const d of t.declarations ?? []) if (d.getSourceFile() === sf) set.add(d);
      } catch {}
    }
  }
  return set;
}
function isExportedUnit(n, exportedDecls) {
  if (ts.isFunctionDeclaration(n)) return exportedDecls.has(n) ? 1 : 0;
  let p = n.parent;
  while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p))) p = p.parent;
  if (p && ts.isVariableDeclaration(p)) return exportedDecls.has(p) ? 1 : 0;
  if (ts.isExportAssignment(p)) return 1;
  const cls = n.parent;
  if (cls && (ts.isClassDeclaration(cls)) && exportedDecls.has(cls)) {
    const mods = ts.getCombinedModifierFlags(n);
    return mods & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected) || (n.name && ts.isPrivateIdentifier(n.name)) ? 0 : 2;
  }
  return 0;
}

// ---------- extraction ----------
const insFile = db.prepare(`INSERT INTO files VALUES (?,?,?,?,?,?,?,?,?,?,0,0)`);
const insUnit = db.prepare(`INSERT INTO units VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insParam = db.prepare(`INSERT INTO params VALUES (?,?,?,?,?,?)`);
const insCall = db.prepare(`INSERT INTO calls VALUES (?,?,?,?,?,?,?,?,?,?)`);
const insArg = db.prepare(`INSERT INTO args VALUES (?,?,?,?,?,?,?)`);
const insImport = db.prepare(`INSERT INTO imports VALUES (?,?,?,?,?,?,?,?)`);
const insImportName = db.prepare(`INSERT INTO import_names VALUES (?,?,?,?,?,?,?)`);
const insType = db.prepare(`INSERT INTO types VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const insValue = db.prepare(`INSERT INTO "values" VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
const insEscape = db.prepare(`INSERT INTO type_escapes VALUES (?,?,?,?,?)`);

const unitIdByNode = new Map(); // function-like node -> id
let nextUnit = 1, nextCall = 1, nextType = 1, nextValue = 1;

// pass 1: assign unit ids so calls can resolve across files
for (const sf of sourceFiles) {
  const visit = (n) => {
    if (isUnitNode(n)) unitIdByNode.set(n, nextUnit++);
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

function declToUnitId(decl) {
  if (!decl) return undefined;
  if (unitIdByNode.has(decl)) return unitIdByNode.get(decl);
  if ((ts.isVariableDeclaration(decl) || ts.isPropertyAssignment(decl) || ts.isPropertyDeclaration(decl)) && decl.initializer) {
    let init = decl.initializer;
    while (ts.isParenthesizedExpression(init) || ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression;
    return unitIdByNode.get(init);
  }
  return undefined;
}
function resolveSymbol(node) {
  let s = checker.getSymbolAtLocation(node);
  if (s && s.flags & ts.SymbolFlags.Alias) {
    try { s = checker.getAliasedSymbol(s); } catch {}
  }
  return s;
}
function declKind(d) {
  if (!d) return null;
  return ts.SyntaxKind[d.kind];
}
function argSummary(a, sf) {
  let e = a;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isElementAccessExpression(e) && ts.isStringLiteral(e.argumentExpression)) return e.argumentExpression.text;
  if (ts.isCallExpression(e)) {
    const c = e.expression;
    return `${ts.isPropertyAccessExpression(c) ? c.name.text : ts.isIdentifier(c) ? c.text : "call"}()`;
  }
  return null;
}
const unitInfo = new Map(); // id -> {params:[{name,type}], file}

let fileCount = 0;
for (const sf of sourceFiles) {
  const path = rel(sf.fileName);
  const exportedDecls = exportedNames(sf);
  const importMap = new Map(); // local -> module specifier
  // imports
  for (const st of sf.statements) {
    const isImp = ts.isImportDeclaration(st);
    const isExp = ts.isExportDeclaration(st) && st.moduleSpecifier;
    if (!isImp && !isExp) continue;
    const spec = st.moduleSpecifier.text;
    const target = checker.getSymbolAtLocation(st.moduleSpecifier);
    const targetSf = target?.valueDeclaration && ts.isSourceFile(target.valueDeclaration) ? target.valueDeclaration : undefined;
    const toFile = targetSf && rootSet.has(resolve(targetSf.fileName)) ? rel(targetSf.fileName) : null;
    const external = spec.startsWith(".") || spec.startsWith("@labshelf/") ? null : spec;
    const names = [];
    const typeOnlyDecl = isImp ? st.importClause?.isTypeOnly ?? false : st.isTypeOnly;
    const handle = (localId, importedName, typeOnly) => {
      names.push(importedName);
      importMap.set(localId.text, spec);
      if (!toFile) return;
      const s = resolveSymbol(localId);
      const d = s?.declarations?.[0];
      const df = d ? d.getSourceFile() : undefined;
      insImportName.run(path, localId.text, importedName, toFile, df && rootSet.has(resolve(df.fileName)) ? rel(df.fileName) : null,
        declKind(d), typeOnly ? 1 : 0);
    };
    if (isImp) {
      const ic = st.importClause;
      if (ic?.name) handle(ic.name, "default", typeOnlyDecl);
      const nb = ic?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) { names.push("*"); importMap.set(nb.name.text, spec); }
      else if (nb) for (const el of nb.elements) handle(el.name, (el.propertyName ?? el.name).text, typeOnlyDecl || el.isTypeOnly);
    } else if (st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        names.push((el.propertyName ?? el.name).text);
        if (toFile) {
          const s = resolveSymbol(el.name);
          const d = s?.declarations?.[0];
          const df = d?.getSourceFile();
          insImportName.run(path, el.name.text, (el.propertyName ?? el.name).text, toFile,
            df && rootSet.has(resolve(df.fileName)) ? rel(df.fileName) : null, declKind(d), (typeOnlyDecl || el.isTypeOnly) ? 1 : 0);
        }
      }
    } else names.push("*");
    insImport.run(path, spec, toFile, external, isImp ? "import" : "reexport", typeOnlyDecl ? 1 : 0, JSON.stringify(names), lineOf(sf, st.getStart(sf)));
  }
  const isBarrel = /\/index\.tsx?$/.test(path) && sf.statements.every((s) => ts.isExportDeclaration(s) || ts.isImportDeclaration(s) ||
    (ts.isExportAssignment(s)) || ts.isTypeAliasDeclaration(s) && false) ? 1 : 0;

  // units, calls, values, types, escapes
  const stack = []; // enclosing unit records
  let units = 0, exportedUnits = 0;
  const unitRecs = [];
  const visit = (n) => {
    let rec;
    if (isUnitNode(n)) {
      const id = unitIdByNode.get(n);
      const nm = unitName(n, sf);
      const locals = localNames(n);
      const parts = [...n.parameters, n.body];
      const t1 = tokenStream(parts, locals, false);
      const t2 = tokenStream(parts, locals, true);
      let signature = null, returnType = null;
      try {
        const sig = checker.getSignatureFromDeclaration(n);
        if (sig) {
          signature = checker.signatureToString(sig, n, TYPE_FLAGS);
          returnType = typeStr(checker.getReturnTypeOfSignature(sig), n);
        }
      } catch {}
      const params = n.parameters.map((p, i) => {
        const name = ts.isIdentifier(p.name) ? p.name.text : short(p.name.getText(sf).replace(/\s+/g, " "), 60);
        const type = typeStr(checker.getTypeAtLocation(p), p);
        const declared = p.type ? p.type.getText(sf).replace(/\s+/g, " ") : null;
        insParam.run(id, i, name, type, declared, p.questionToken || p.initializer ? 1 : 0);
        return { name, type };
      });
      unitInfo.set(id, { params });
      const exported = isExportedUnit(n, exportedDecls);
      const startLine = lineOf(sf, n.getStart(sf));
      const endLine = lineOf(sf, n.end);
      const statements = n.body && ts.isBlock(n.body) ? n.body.statements.length : 1;
      rec = { id, nm, n, locals, exported, startLine, endLine, t1: sha(t1.toks.join(" ")), t2: sha(t2.toks.join(" ")),
        nodes: t1.count, signature, returnType, params, statements, calls: new Set(), imports: new Set(), effects: new Set(),
        parent: stack.length ? stack[stack.length - 1].id : null };
      unitRecs.push(rec);
      units++;
      if (exported) exportedUnits++;
      // concept params -> values
      n.parameters.forEach((p, i) => {
        if (!ts.isIdentifier(p.name)) return;
        const c = conceptOf(p.name.text);
        if (!c) return;
        const t = params[i].type;
        insValue.run(nextValue++, p.name.text, c, "param", `${nm.owner ? nm.owner + "." : ""}${nm.name}`, path, pkgOf(path),
          lineOf(sf, p.getStart(sf)), t, p.type ? p.type.getText(sf) : null, /^(string|number|string \| undefined|number \| undefined|string \| null)$/.test(t) ? 1 : 0, id);
      });
      stack.push(rec);
    }
    const cur = stack[stack.length - 1];
    // calls
    if (cur && (ts.isCallExpression(n) || ts.isNewExpression(n))) {
      const ex = n.expression;
      const nameNode = ts.isPropertyAccessExpression(ex) ? ex.name : ex;
      let calleeName = ts.isPropertyAccessExpression(ex) ? `${short(ex.expression.getText(sf).replace(/\s+/g, ""), 30)}.${ex.name.text}`
        : ts.isIdentifier(ex) ? ex.text : short(ex.getText(sf).replace(/\s+/g, ""), 40);
      const s = resolveSymbol(nameNode);
      const d = s?.declarations?.[0];
      const calleeId = declToUnitId(d) ?? (s?.valueDeclaration ? declToUnitId(s.valueDeclaration) : undefined);
      const df = d?.getSourceFile();
      const calleeFile = df ? (rootSet.has(resolve(df.fileName)) ? rel(df.fileName) : df.fileName.includes("node_modules") ? "external" : null) : null;
      let receiverType = null;
      if (ts.isPropertyAccessExpression(ex)) {
        try {
          const rt = checker.getTypeAtLocation(ex.expression);
          const rs = rt.getSymbol() ?? rt.aliasSymbol;
          receiverType = rs ? rs.getName() : null;
          const rd = rs?.declarations?.[0]?.getSourceFile()?.fileName ?? "";
          if (/lib\.dom/.test(rd)) cur.effects.add("dom");
          else if (/@types\/vscode/.test(rd)) cur.effects.add("vscode");
          else if (/@types\/node/.test(rd)) cur.effects.add("node");
          else if (/\/core\/src\/ports\//.test(rd)) cur.effects.add(`port:${rs.getName()}`);
        } catch {}
      }
      const callId = nextCall++;
      insCall.run(callId, cur.id, calleeId ?? null, calleeName, calleeFile, declKind(d), receiverType, path, lineOf(sf, n.getStart(sf)), ts.isNewExpression(n) ? 1 : 0);
      cur.calls.add(calleeName.includes(".") ? calleeName.split(".").pop() : calleeName);
      if (calleeId && n.arguments) {
        const callee = unitInfo.get(calleeId);
        n.arguments.forEach((a, i) => {
          const an = argSummary(a, sf);
          if (!an) return;
          let at = null;
          try { at = typeStr(checker.getTypeAtLocation(a), a); } catch {}
          insArg.run(callId, i, callee?.params[i]?.name ?? null, callee?.params[i]?.type ?? null, an, short(a.getText(sf).replace(/\s+/g, " "), 80), at);
        });
      }
    }
    // identifiers -> imports used, global effects
    if (cur && ts.isIdentifier(n) && !isPropertyNamePosition(n)) {
      const spec = importMap.get(n.text);
      if (spec && !cur.locals.has(n.text)) {
        for (const r of stack) {
          r.imports.add(`${spec}:${n.text}`);
          for (const [re, eff] of MODULE_EFFECTS) if (re.test(spec)) r.effects.add(eff);
        }
      } else if (!spec && GLOBAL_EFFECTS.has(n.text) && !cur.locals.has(n.text)) {
        for (const r of stack) r.effects.add(GLOBAL_EFFECTS.get(n.text));
      }
    }
    // effects from inner units' calls propagate lexically
    // type escapes
    if (n.kind === ts.SyntaxKind.AnyKeyword) insEscape.run(path, lineOf(sf, n.getStart(sf)), "any", short(n.parent.getText(sf).replace(/\s+/g, " "), 80), cur?.id ?? null);
    else if (n.kind === ts.SyntaxKind.UnknownKeyword && !(ts.isAsExpression(n.parent))) insEscape.run(path, lineOf(sf, n.getStart(sf)), "unknown", short(n.parent.getText(sf).replace(/\s+/g, " "), 80), cur?.id ?? null);
    else if (ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) {
      const tt = n.type.getText(sf);
      const kind = tt === "const" ? "as-const" : ts.isAsExpression(n.expression) && n.expression.type.kind === ts.SyntaxKind.UnknownKeyword ? "as-unknown-as"
        : n.type.kind === ts.SyntaxKind.UnknownKeyword ? null : "as";
      if (kind) insEscape.run(path, lineOf(sf, n.getStart(sf)), kind, short(n.getText(sf).replace(/\s+/g, " "), 80), cur?.id ?? null);
    } else if (ts.isNonNullExpression(n)) insEscape.run(path, lineOf(sf, n.getStart(sf)), "non-null", short(n.getText(sf).replace(/\s+/g, " "), 80), cur?.id ?? null);
    // fields -> values
    if ((ts.isPropertySignature(n) || ts.isPropertyDeclaration(n)) && n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) {
      const c = conceptOf(n.name.text);
      if (c) {
        const owner = n.parent && (ts.isInterfaceDeclaration(n.parent) || ts.isClassDeclaration(n.parent)) ? n.parent.name?.text ?? "<anon>"
          : n.parent?.parent && ts.isTypeAliasDeclaration(n.parent.parent) ? n.parent.parent.name.text : "<literal>";
        const t = typeStr(checker.getTypeAtLocation(n), n);
        insValue.run(nextValue++, n.name.text, c, ts.isPropertyDeclaration(n) ? "class-field" : "field", owner, path, pkgOf(path),
          lineOf(sf, n.getStart(sf)), t, n.type ? n.type.getText(sf) : null, /^(string|number|string \| undefined|number \| undefined|string \| null)$/.test(t) ? 1 : 0, cur?.id ?? null);
      }
    }
    // types
    if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isEnumDeclaration(n)) recordType(n, sf, path, exportedDecls);
    ts.forEachChild(n, visit);
    if (rec) stack.pop();
  };
  visit(sf);
  for (const r of unitRecs) {
    insUnit.run(r.id, path, r.nm.name, r.nm.kind, r.nm.owner ?? null, r.nm.context ?? null, r.exported, r.startLine, r.endLine,
      r.endLine - r.startLine + 1, r.nodes, r.statements, r.parent, r.signature, r.returnType, r.params.length,
      JSON.stringify([...r.calls].sort()), JSON.stringify([...r.imports].sort()), JSON.stringify([...r.effects].sort()), r.t1, r.t2);
  }
  insFile.run(path, pkgOf(path), domainOf(path), path.slice(0, path.lastIndexOf("/")), path.slice(path.lastIndexOf("/") + 1),
    sf.getLineAndCharacterOfPosition(sf.end).line + (sf.text.endsWith("\n") ? 0 : 1), units, exportedUnits, runtimeOf(path), isBarrel);
  if (++fileCount % 200 === 0) console.log(`  ${fileCount} files`);
}

function recordType(n, sf, path, exportedDecls) {
  const name = n.name.text;
  let shape, memberNames = [];
  const generic = n.typeParameters?.length ? 1 : 0;
  if (ts.isEnumDeclaration(n)) {
    memberNames = n.members.map((m) => propName(m.name) ?? "?");
    shape = `enum{${n.members.map((m) => `${propName(m.name)}=${m.initializer?.getText(sf) ?? ""}`).sort().join(",")}}`;
  } else {
    const sym = checker.getSymbolAtLocation(n.name);
    const type = sym ? checker.getDeclaredTypeOfSymbol(sym) : undefined;
    const typeNode = ts.isTypeAliasDeclaration(n) ? n.type : undefined;
    const objectLike = ts.isInterfaceDeclaration(n) || (typeNode && (ts.isTypeLiteralNode(typeNode) || ts.isIntersectionTypeNode(typeNode) ||
      ts.isMappedTypeNode(typeNode) === false && ts.isTypeReferenceNode(typeNode) && /^(Pick|Omit|Partial|Required|Readonly)$/.test(typeNode.typeName.getText(sf))));
    if (type && objectLike && !(type.flags & ts.TypeFlags.Union)) {
      const props = checker.getPropertiesOfType(type);
      const items = props.map((p) => {
        memberNames.push(p.getName());
        const opt = p.flags & ts.SymbolFlags.Optional ? "?" : "";
        let pt = "?";
        try { pt = typeStr(checker.getTypeOfSymbolAtLocation(p, n), n); } catch {}
        return `${p.getName()}${opt}:${pt.replace(/\s+/g, "")}`;
      });
      const sigs = [...checker.getSignaturesOfType(type, ts.SignatureKind.Call)].map((s) => `call:${checker.signatureToString(s, n, TYPE_FLAGS).replace(/\s+/g, "")}`);
      const idx = checker.getIndexInfosOfType(type).map((i) => `[${typeStr(i.keyType)}]:${typeStr(i.type).replace(/\s+/g, "")}`);
      shape = `{${[...items, ...sigs, ...idx].sort().join(";")}}`;
      memberNames.sort();
    } else if (typeNode) {
      const norm = (t) => t.getText(sf).replace(/\s+/g, "");
      if (ts.isUnionTypeNode(typeNode)) {
        const parts = typeNode.types.map(norm).sort();
        memberNames = parts;
        shape = parts.join("|");
      } else shape = norm(typeNode);
    } else shape = "?";
  }
  insType.run(nextType++, name, path, ts.isInterfaceDeclaration(n) ? "interface" : ts.isEnumDeclaration(n) ? "enum" : "alias",
    exportedDecls.has(n) ? 1 : 0, lineOf(sf, n.getStart(sf)), memberNames.length, JSON.stringify(memberNames), short(shape, 4000), sha(shape), generic);
}

// ---------- dirs ----------
const fileRows = db.prepare(`SELECT path, dir, lines FROM files`).all();
const dirMap = new Map();
const ensure = (d) => {
  if (!dirMap.has(d)) dirMap.set(d, { files: 0, lines: 0, subdirs: new Set(), filesR: 0, linesR: 0, sizes: [] });
  return dirMap.get(d);
};
for (const f of fileRows) {
  const d = ensure(f.dir);
  d.files++; d.lines += f.lines; d.sizes.push(f.lines);
  let cur = f.dir;
  while (cur.split("/").length >= 3) {
    const e = ensure(cur);
    e.filesR++; e.linesR += f.lines;
    const parent = cur.slice(0, cur.lastIndexOf("/"));
    if (parent.split("/").length >= 3) ensure(parent).subdirs.add(cur);
    cur = parent;
  }
}
const insDir = db.prepare(`INSERT INTO dirs VALUES (?,?,?,?,?,?,?,?,?)`);
for (const [p, d] of dirMap) {
  const s = d.sizes.sort((a, b) => a - b);
  const median = s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
  insDir.run(p, p.split("/")[1], p.split("/").length - 3, d.files, d.subdirs.size, d.lines, d.filesR, d.linesR, median);
}

// ---------- fan-in / fan-out (through barrels to the declaring file) ----------
db.exec(`
CREATE TABLE file_edges AS
  SELECT DISTINCT from_file, COALESCE(decl_file, via_file) AS to_file FROM import_names
  WHERE COALESCE(decl_file, via_file) IS NOT NULL AND COALESCE(decl_file, via_file) <> from_file
  UNION SELECT DISTINCT from_file, to_file FROM imports WHERE to_file IS NOT NULL AND names = '["*"]' AND to_file <> from_file;
UPDATE files SET fan_out = (SELECT COUNT(DISTINCT to_file) FROM file_edges e WHERE e.from_file = files.path),
                 fan_in  = (SELECT COUNT(DISTINCT from_file) FROM file_edges e WHERE e.to_file = files.path);
CREATE INDEX units_file ON units(file); CREATE INDEX units_name ON units(name); CREATE INDEX units_t1 ON units(t1);
CREATE INDEX units_t2 ON units(t2); CREATE INDEX calls_caller ON calls(caller_id); CREATE INDEX calls_callee ON calls(callee_id);
CREATE INDEX params_unit ON params(unit_id); CREATE INDEX types_hash ON types(shape_hash); CREATE INDEX values_concept ON "values"(concept);
`);
const c = db.prepare(`SELECT (SELECT COUNT(*) FROM files) f, (SELECT COUNT(*) FROM units) u, (SELECT COUNT(*) FROM calls) c,
  (SELECT COUNT(*) FROM types) t, (SELECT COUNT(*) FROM "values") v, (SELECT COUNT(*) FROM dirs) d`).get();
console.log(`done: ${JSON.stringify(c)}`);
db.close();
