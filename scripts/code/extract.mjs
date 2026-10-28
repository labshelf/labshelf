// Builds .code-facts/facts.db from the product source: files, modules, module exports, units, calls, import edges,
// comment tags, tests, per-unit search text and clone fingerprints, and full-text indexes, through one TypeScript program over all packages.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { listFiles, ts } from "../codemods/shared.mjs";
import { unitFingerprint } from "./tokens.mjs";
import {
  DB_PATH,
  FACTS_DIR,
  LOCK_PATH,
  PACKAGES,
  ROOT,
  SCHEMA_VERSION,
  acquireLock,
  domainOf,
  firstSentences,
  headerOf,
  mirrorSourcesOf,
  moduleOf,
  runtimeOf,
  splitWords,
  tagsOf,
  typeKey,
  unitSearchText,
} from "./lib.mjs";

const started = Date.now();
const quiet = process.argv.includes("--quiet");
const say = (line) => quiet || console.log(line);

mkdirSync(FACTS_DIR, { recursive: true });
mkdirSync(dirname(DB_PATH), { recursive: true });
const release = acquireLock(LOCK_PATH);
if (!release) {
  say("facts: another build holds .code-facts/build.lock; skipping");
  process.exit(0);
}

const TMP_PATH = `${DB_PATH}.tmp-${process.pid}`;
try {
  await build();
  renameSync(TMP_PATH, DB_PATH);
} finally {
  rmSync(TMP_PATH, { force: true });
  release();
}

async function build() {
  const isSource = (path) => /\.tsx?$/.test(path) && !path.endsWith(".d.ts");
  const productFiles = listFiles(ROOT, PACKAGES.map((pkg) => `packages/${pkg}/src`)).filter(isSource).sort();
  const testFiles = listFiles(ROOT, PACKAGES.map((pkg) => `packages/${pkg}/__tests__`)).filter(isSource).sort();
  const productSet = new Set(productFiles);
  const testSet = new Set(testFiles);

  const typeRoots = PACKAGES.map((pkg) => join(ROOT, "packages", pkg, "node_modules", "@types")).filter(existsSync);
  const program = ts.createProgram({
    rootNames: [...productFiles, ...testFiles].map((path) => join(ROOT, path)),
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      allowImportingTsExtensions: true,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
      typeRoots,
      types: ["node", "vscode", "webextension-polyfill", "jest"],
    },
  });
  const checker = program.getTypeChecker();
  const rel = (abs) => relative(ROOT, abs).split("\\").join("/");
  const sources = new Map();
  for (const sf of program.getSourceFiles()) {
    const path = rel(sf.fileName);
    if (productSet.has(path) || testSet.has(path)) sources.set(path, sf);
  }

  // ---------- checker helpers ----------
  const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const short = (text, max = 240) => {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  };
  const FLAGS = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;
  const guard = (fn) => {
    try {
      return fn();
    } catch {
      return "";
    }
  };
  const aliased = (symbol) => {
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) return guard(() => checker.getAliasedSymbol(symbol)) || symbol;
    return symbol;
  };
  const docOf = (symbol) => (symbol ? firstSentences(ts.displayPartsToString(guard(() => symbol.getDocumentationComment(checker)) || []), 200) : "");
  const signatureOfFunction = (node) =>
    guard(() => {
      const signature = checker.getSignatureFromDeclaration(node);
      return signature ? checker.signatureToString(signature, node, FLAGS) : "";
    });
  const unwrap = (node) => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
    return node;
  };
  const parentOf = (node) => {
    let parent = node.parent;
    while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent))) parent = parent.parent;
    return parent;
  };

  function declarationInfo(decl) {
    const sf = decl.getSourceFile();
    const name = ts.getNameOfDeclaration(decl);
    const symbol = name ? checker.getSymbolAtLocation(name) : undefined;
    const doc = docOf(symbol);
    let kind = ts.SyntaxKind[decl.kind];
    let signature = "";
    if (ts.isFunctionDeclaration(decl)) [kind, signature] = ["function", signatureOfFunction(decl)];
    else if (ts.isClassDeclaration(decl)) [kind, signature] = ["class", `class ${decl.name?.text ?? "default"}`];
    else if (ts.isInterfaceDeclaration(decl)) [kind, signature] = ["interface", short(decl.getText(sf), 240)];
    else if (ts.isTypeAliasDeclaration(decl)) [kind, signature] = ["type", short(decl.getText(sf), 240)];
    else if (ts.isEnumDeclaration(decl)) [kind, signature] = ["enum", `enum ${decl.name.text}`];
    else if (ts.isVariableDeclaration(decl)) {
      const init = unwrap(decl.initializer);
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) [kind, signature] = ["function", signatureOfFunction(init)];
      else [kind, signature] = ["const", guard(() => checker.typeToString(checker.getTypeAtLocation(decl), decl, FLAGS))];
    } else if (ts.isModuleDeclaration(decl)) kind = "namespace";
    return { file: rel(sf.fileName), line: lineOf(sf, decl.getStart(sf)), kind, signature: short(signature), doc };
  }

  // ---------- db ----------
  rmSync(TMP_PATH, { force: true });
  const db = new DatabaseSync(TMP_PATH);
  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE files (path TEXT PRIMARY KEY, package TEXT, domain TEXT, module TEXT, runtime TEXT, lines INTEGER, is_barrel INTEGER, header TEXT);
    CREATE TABLE modules (path TEXT PRIMARY KEY, package TEXT, domain TEXT, runtime TEXT, purpose TEXT, files INTEGER, lines INTEGER);
    CREATE TABLE exports (module TEXT, name TEXT, kind TEXT, signature TEXT, file TEXT, line INTEGER, doc TEXT);
    CREATE TABLE units (id INTEGER PRIMARY KEY, file TEXT, name TEXT, owner TEXT, kind TEXT, exported INTEGER, start_line INTEGER, end_line INTEGER, signature TEXT, doc TEXT);
    CREATE TABLE calls (caller_id INTEGER, callee_id INTEGER, callee_name TEXT, file TEXT, line INTEGER);
    CREATE TABLE file_edges (from_file TEXT, to_file TEXT, names TEXT, PRIMARY KEY (from_file, to_file));
    CREATE TABLE module_edges (from_module TEXT, to_module TEXT, weight INTEGER, PRIMARY KEY (from_module, to_module));
    CREATE TABLE tags (file TEXT, line INTEGER, tag TEXT, text TEXT);
    CREATE TABLE tests (test_file TEXT, source_file TEXT, how TEXT, PRIMARY KEY (test_file, source_file, how));
    CREATE TABLE reexports (file TEXT, line INTEGER, name TEXT, from_file TEXT);
    CREATE VIRTUAL TABLE search_fts USING fts5(kind, ref, name, words, body, tokenize = 'porter unicode61');
    CREATE TABLE unit_facts (id INTEGER PRIMARY KEY, nodes INTEGER, t1 TEXT, t2 TEXT, body_t1 TEXT, body_t2 TEXT, shingles BLOB, params TEXT, returns TEXT, calls TEXT);
    CREATE TABLE idents (name TEXT PRIMARY KEY, local_n INTEGER, free_n INTEGER);
    CREATE VIRTUAL TABLE unit_fts USING fts5(unit_id UNINDEXED, name, types, calls, text, header, tokenize = 'porter unicode61');
  `);
  const insert = (table, count) => db.prepare(`INSERT INTO ${table} VALUES (${Array(count).fill("?").join(",")})`);
  const ins = {
    file: insert("files", 8),
    module: insert("modules", 7),
    export: insert("exports", 7),
    unit: insert("units", 10),
    call: insert("calls", 5),
    fileEdge: insert("file_edges", 3),
    moduleEdge: insert("module_edges", 3),
    tag: insert("tags", 4),
    test: db.prepare("INSERT OR IGNORE INTO tests VALUES (?,?,?)"),
    fts: insert("search_fts", 5),
    reexport: insert("reexports", 4),
    unitFacts: insert("unit_facts", 10),
    ident: insert("idents", 3),
    unitFts: insert("unit_fts", 6),
    meta: insert("meta", 2),
  };
  db.exec("BEGIN");

  // ---------- files and tags ----------
  const fileInfo = new Map();
  for (const path of productFiles) {
    const sf = sources.get(path);
    const text = sf ? sf.text : readFileSync(join(ROOT, path), "utf8");
    const lines = text.split("\n").length;
    const header = headerOf(text);
    const statements = sf?.statements ?? [];
    const isBarrel =
      statements.length > 0 &&
      statements.some((st) => ts.isExportDeclaration(st) && st.moduleSpecifier) &&
      statements.every((st) => ts.isExportDeclaration(st) || ts.isImportDeclaration(st));
    fileInfo.set(path, { lines, header });
    ins.file.run(path, path.split("/")[1], domainOf(path), moduleOf(path), runtimeOf(path), lines, isBarrel ? 1 : 0, header);
    ins.fts.run("file", path, path.slice(path.lastIndexOf("/") + 1), splitWords(path), header);
    for (const tag of tagsOf(text)) ins.tag.run(path, tag.line, tag.tag, tag.text);
  }

  // ---------- modules and their exports ----------
  const moduleFiles = new Map();
  for (const path of productFiles) {
    const module = moduleOf(path);
    if (!moduleFiles.has(module)) moduleFiles.set(module, []);
    moduleFiles.get(module).push(path);
  }
  for (const [module, files] of moduleFiles) {
    const index = files.find((path) => path === `${module}/index.ts` || path === `${module}/index.tsx`);
    const largest = [...files].sort((a, b) => fileInfo.get(b).lines - fileInfo.get(a).lines)[0];
    const purpose = fileInfo.get(index ?? largest).header;
    const runtimes = [...new Set(files.map(runtimeOf))].sort();
    const lines = files.reduce((sum, path) => sum + fileInfo.get(path).lines, 0);
    ins.module.run(module, module.split("/")[1], domainOf(`${module}/x`), runtimes.join(","), purpose, files.length, lines);
    ins.fts.run("module", module, module.slice(module.lastIndexOf("/") + 1), splitWords(module), purpose);

    const seen = new Set();
    for (const indexPath of files.filter((path) => /\/index\.tsx?$/.test(path))) {
      const sf = sources.get(indexPath);
      const moduleSymbol = sf && checker.getSymbolAtLocation(sf);
      if (!moduleSymbol) continue;
      for (const exported of checker.getExportsOfModule(moduleSymbol)) {
        const target = aliased(exported);
        const decl = target.declarations?.[0];
        if (!decl) continue;
        const info = declarationInfo(decl);
        const key = `${exported.name}\0${info.file}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const doc = info.doc || docOf(target);
        ins.export.run(module, exported.name, info.kind, info.signature, info.file, info.line, doc);
        ins.fts.run("export", `${info.file}:${info.line}`, exported.name, splitWords(`${exported.name} ${module}`), `${info.signature} ${doc}`);
      }
    }
  }

  // ---------- units ----------
  const isUnitNode = (node) =>
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node);
  const propName = (node) =>
    node && (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) ? node.text : undefined;
  const ownerOfMember = (node) => {
    const parent = node.parent;
    if (parent && (ts.isClassDeclaration(parent) || ts.isClassExpression(parent))) return parent.name?.text ?? "<class>";
    if (parent && ts.isObjectLiteralExpression(parent)) {
      const holder = parentOf(parent);
      if (holder && ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)) return holder.name.text;
      if (holder && ts.isPropertyAssignment(holder)) return propName(holder.name) ?? "<object>";
      return "<object>";
    }
    return "";
  };
  // Anonymous callbacks are not units: their calls count for the named unit around them.
  function unitNameOf(node) {
    if (ts.isFunctionDeclaration(node)) return { name: node.name?.text ?? "default", owner: "", kind: "function", nameNode: node.name, holder: node };
    if (ts.isConstructorDeclaration(node)) return { name: "constructor", owner: ownerOfMember(node), kind: "constructor", holder: node };
    if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      const name = propName(node.name);
      const kind = ts.isMethodDeclaration(node) ? "method" : ts.isGetAccessorDeclaration(node) ? "getter" : "setter";
      return name && { name, owner: ownerOfMember(node), kind, nameNode: node.name, holder: node };
    }
    if (ts.isFunctionExpression(node) && node.name) return { name: node.name.text, owner: "", kind: "function", nameNode: node.name, holder: node };
    const parent = parentOf(node);
    if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name))
      return { name: parent.name.text, owner: "", kind: "function", nameNode: parent.name, holder: parent };
    if (parent && (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent))) {
      const name = propName(parent.name);
      return name && { name, owner: ownerOfMember(parent), kind: "method", nameNode: parent.name, holder: parent };
    }
    return undefined;
  }
  const exportedDeclsOf = (sf) => {
    const set = new Set();
    const symbol = checker.getSymbolAtLocation(sf);
    if (!symbol) return set;
    for (const exported of checker.getExportsOfModule(symbol))
      for (const decl of aliased(exported).declarations ?? []) if (decl.getSourceFile() === sf) set.add(decl);
    return set;
  };
  const isExported = (unit, exportedDecls) => {
    if (exportedDecls.has(unit.holder)) return 1;
    const cls = unit.holder.parent;
    if (cls && ts.isClassDeclaration(cls) && exportedDecls.has(cls)) {
      const flags = ts.getCombinedModifierFlags(unit.holder);
      const hidden = flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected) || (unit.nameNode && ts.isPrivateIdentifier(unit.nameNode));
      return hidden ? 0 : 1;
    }
    return 0;
  };

  const unitIdByNode = new Map();
  const unitIdByHolder = new Map();
  const unitRecords = [];
  let nextUnit = 1;
  for (const path of productFiles) {
    const sf = sources.get(path);
    if (!sf) continue;
    const exportedDecls = exportedDeclsOf(sf);
    const visit = (node) => {
      if (isUnitNode(node)) {
        const unit = unitNameOf(node);
        if (unit) {
          const id = nextUnit++;
          unitIdByNode.set(node, id);
          unitIdByHolder.set(unit.holder, id);
          const symbol = unit.nameNode ? checker.getSymbolAtLocation(unit.nameNode) : undefined;
          const signature = short(signatureOfFunction(node));
          ins.unit.run(id, path, unit.name, unit.owner, unit.kind, isExported(unit, exportedDecls), lineOf(sf, node.getStart(sf)), lineOf(sf, node.end), signature, docOf(symbol));
          const label = unit.owner ? `${unit.owner}.${unit.name}` : unit.name;
          unitRecords.push({ id, node, unit, sf, path, signature, doc: docOf(symbol), exported: isExported(unit, exportedDecls) });
          ins.fts.run("unit", `${path}:${lineOf(sf, node.getStart(sf))}`, label, splitWords(label), `${signature} ${docOf(symbol)}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  // ---------- calls ----------
  const unitIdOfDecl = (decl) => {
    if (!decl) return undefined;
    if (unitIdByNode.has(decl)) return unitIdByNode.get(decl);
    return unitIdByHolder.get(decl);
  };
  const calleeNameNode = (expression) => {
    const callee = unwrap(expression);
    if (ts.isIdentifier(callee)) return callee;
    if (ts.isPropertyAccessExpression(callee)) return callee.name;
    return undefined;
  };
  for (const path of productFiles) {
    const sf = sources.get(path);
    if (!sf) continue;
    const visit = (node, callerId) => {
      if (unitIdByNode.has(node)) callerId = unitIdByNode.get(node);
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const nameNode = calleeNameNode(node.expression);
        const symbol = nameNode && aliased(checker.getSymbolAtLocation(nameNode));
        const decl = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
        let calleeId = unitIdOfDecl(decl);
        if (calleeId === undefined && decl && ts.isClassDeclaration(decl))
          calleeId = unitIdOfDecl(decl.members.find((member) => ts.isConstructorDeclaration(member)));
        if (calleeId !== undefined) ins.call.run(callerId ?? null, calleeId, nameNode.text, path, lineOf(sf, node.getStart(sf)));
      }
      ts.forEachChild(node, (child) => visit(child, callerId));
    };
    visit(sf, undefined);
  }

  // ---------- unit facts: search text for `facts fn`, structural keys for `facts sig`, fingerprints for `facts similar` ----------
  const MAX_LITERALS = 10;
  const typesOf = (node) =>
    guard(() => {
      const signature = checker.getSignatureFromDeclaration(node);
      if (!signature) return undefined;
      const params = signature.parameters.map((param) => checker.typeToString(checker.getTypeOfSymbolAtLocation(param, node), node, FLAGS));
      return { params, returns: checker.typeToString(checker.getReturnTypeOfSignature(signature), node, FLAGS) };
    }) || { params: [], returns: "" };
  // The comment block right above the declaration; a block separated by a blank line (the file header) is not its comment.
  const commentOf = (sf, holder) => {
    let anchor = holder;
    if (ts.isVariableDeclaration(holder) && holder.parent?.parent && ts.isVariableStatement(holder.parent.parent)) anchor = holder.parent.parent;
    const ranges = ts.getLeadingCommentRanges(sf.text, anchor.getFullStart()) ?? [];
    const kept = [];
    let next = anchor.getStart(sf);
    for (let i = ranges.length - 1; i >= 0 && !/\n[ \t]*\r?\n/.test(sf.text.slice(ranges[i].end, next)); i--) {
      kept.unshift(sf.text.slice(ranges[i].pos, ranges[i].end));
      next = ranges[i].pos;
    }
    return firstSentences(kept.join(" ").replace(/\/\*+|\*+\/|^\s*\*|\/\/+/gm, " "), 240);
  };
  // Calls and literals of a unit; nested named units are their own, anonymous callbacks count for the unit around them.
  const bodyFactsOf = (unitNode) => {
    const calls = new Set();
    const literals = new Set();
    const visit = (node) => {
      if (node !== unitNode && unitIdByNode.has(node)) return;
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const nameNode = calleeNameNode(node.expression);
        if (nameNode) calls.add(nameNode.text);
      } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.trim() && literals.size < MAX_LITERALS) {
        if (!ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent)) literals.add(short(node.text, 60));
      }
      ts.forEachChild(node, visit);
    };
    visit(unitNode);
    return { calls: [...calls], literals: [...literals] };
  };
  const identUses = new Map();
  for (const record of unitRecords) {
    const { id, node, unit, sf, path, signature, doc, exported } = record;
    const { params, returns } = typesOf(node);
    const { calls, literals } = bodyFactsOf(node);
    const comment = commentOf(sf, unit.holder);
    const search = unitSearchText({ ...unit, exported, signature, doc, comment, params, returns, calls, literals, header: fileInfo.get(path).header });
    const print = node.body ? unitFingerprint(node, identUses) : undefined;
    const blob = print ? new Uint8Array(print.shingles.buffer, print.shingles.byteOffset, print.shingles.byteLength) : null;
    ins.unitFacts.run(
      id,
      print?.nodes ?? 0,
      print?.t1 ?? null,
      print?.t2 ?? null,
      print?.bodyT1 ?? null,
      print?.bodyT2 ?? null,
      blob,
      JSON.stringify(params.map(typeKey)),
      typeKey(returns),
      JSON.stringify(calls),
    );
    ins.unitFts.run(id, search.name, search.types, search.calls, search.text, search.header);
  }
  for (const [name, [local, free]] of identUses) ins.ident.run(name, local, free);

  // ---------- import edges, resolved through barrels to the declaring file ----------
  const moduleFileOf = (specifier) => {
    const symbol = checker.getSymbolAtLocation(specifier);
    const decl = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    return decl ? rel(decl.getSourceFile().fileName) : undefined;
  };
  const declFilesOf = (nameNode) => {
    const symbol = aliased(checker.getSymbolAtLocation(nameNode));
    return [...new Set((symbol?.declarations ?? []).map((decl) => rel(decl.getSourceFile().fileName)))];
  };
  function edgesOf(sf) {
    const edges = new Map();
    const add = (to, name) => {
      if (!productSet.has(to)) return;
      if (!edges.has(to)) edges.set(to, new Set());
      if (name) edges.get(to).add(name);
    };
    for (const statement of sf.statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier) continue;
      const moduleFile = moduleFileOf(statement.moduleSpecifier);
      const named = [];
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.name) named.push(clause.name);
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) named.push(...bindings.elements.map((element) => element.name));
      } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        named.push(...statement.exportClause.elements.map((element) => element.name));
      }
      if (named.length === 0 && moduleFile) add(moduleFile);
      for (const nameNode of named) {
        const files = declFilesOf(nameNode).filter((file) => productSet.has(file));
        if (files.length === 0 && moduleFile) add(moduleFile, nameNode.text);
        for (const file of files) add(file, nameNode.text);
      }
    }
    return edges;
  }
  const moduleWeights = new Map();
  for (const path of productFiles) {
    const sf = sources.get(path);
    if (!sf) continue;
    for (const [to, names] of edgesOf(sf)) {
      if (to === path) continue;
      ins.fileEdge.run(path, to, [...names].sort().join(","));
      const [from, target] = [moduleOf(path), moduleOf(to)];
      if (from === target) continue;
      const key = `${from}\0${target}`;
      moduleWeights.set(key, (moduleWeights.get(key) ?? 0) + 1);
    }
  }
  // `export { a } from "./x"` lines, with the file that declares each name, for `facts def`.
  for (const path of productFiles) {
    const sf = sources.get(path);
    if (!sf) continue;
    for (const statement of sf.statements) {
      if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
      for (const element of statement.exportClause.elements) {
        const from = declFilesOf(element.name).find((file) => productSet.has(file));
        if (from && from !== path) ins.reexport.run(path, lineOf(sf, element.getStart(sf)), element.name.text, from);
      }
    }
  }
  for (const [key, weight] of moduleWeights) ins.moduleEdge.run(...key.split("\0"), weight);

  // ---------- tests ----------
  for (const path of testFiles) {
    for (const source of mirrorSourcesOf(path)) if (productSet.has(source)) ins.test.run(path, source, "mirror");
    const sf = sources.get(path);
    if (sf) for (const to of edgesOf(sf).keys()) ins.test.run(path, to, "import");
  }

  // ---------- meta ----------
  const headSha = guard(() => execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim());
  ins.meta.run("schema_version", SCHEMA_VERSION);
  ins.meta.run("head_sha", headSha);
  ins.meta.run("built_at", new Date().toISOString());
  ins.meta.run("build_ms", String(Date.now() - started));
  db.exec("COMMIT");
  db.exec("INSERT INTO search_fts(search_fts) VALUES ('optimize')");
  db.exec("INSERT INTO unit_fts(unit_fts) VALUES ('optimize')");

  const counts = ["files", "modules", "exports", "units", "calls", "file_edges", "module_edges", "reexports", "tags", "tests", "search_fts"].map(
    (table) => `${table} ${db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n}`,
  );
  db.close();
  say(`facts: ${counts.join(", ")}`);
  say(`facts: built ${rel(DB_PATH)} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
