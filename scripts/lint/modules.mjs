// Package rules for packages/*/src: every folder below a domain is a module that works like a Java package, with its
// public API in index.ts and internals only its own files use. It must hide something, hold together and sit next to
// its users. Satellites and re-declared shared helpers fail anywhere; clusters that should be a module only warn.
// Usage: node scripts/lint/modules.mjs [--update] — --update rewrites scripts/lint/modulesBaseline.json from the
// current violations. A violation outside the baseline fails, and so does a baseline entry that no longer fails.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE = join(root, "scripts", "lint", "modulesBaseline.json");
const PACKAGES = ["core", "vscode", "browser", "terminal"];
const PRODUCT = new RegExp(`^packages/(${PACKAGES.join("|")})/src/.+\\.tsx?$`);
const RUNTIME_FOLDERS = new Set(["node", "dom", "worker", "webview"]);
// Core modules whose exports no other file may re-declare privately. Add each new core/<subject> module here.
const SHARED_MODULES = ["packages/core/src/encoding", "packages/core/src/guards", "packages/core/src/hash", "packages/core/src/json", "packages/core/src/path", "packages/core/src/url", "packages/core/src/time", "packages/core/src/async"];
const SATELLITE_LINES = 80;
export const RULES = ["no-index", "hides-nothing", "orphan-file", "misplaced", "cycle-with-parent", "satellite", "shared-name"];

// ---------- paths ----------
// INVARIANT: paths are repo-relative with "/" and start with packages/<pkg>/src, so segment 3 is the domain.
const SRC_DEPTH = 3;
const dirOf = (path) => path.slice(0, path.lastIndexOf("/"));
const segments = (path) => path.split("/");
const isInside = (path, folder) => path.startsWith(`${folder}/`);
const isRuntime = (folder) => RUNTIME_FOLDERS.has(folder.slice(folder.lastIndexOf("/") + 1));
const depthOf = (folder) => segments(folder).length - SRC_DEPTH;
const isProductPath = (path) => PRODUCT.test(path) && !path.endsWith(".d.ts") && !path.includes("/__tests__/") && !/\.test\.tsx?$/.test(path);

// The nearest non-runtime folder at or above `folder`: runtime folders are transparent.
function ownerOf(folder) {
  let owner = folder;
  while (depthOf(owner) > 0 && isRuntime(owner)) owner = dirOf(owner);
  return owner;
}
const parentOf = (module) => ownerOf(dirOf(module));
const stripRuntime = (folder) => segments(folder).filter((part, i) => i < SRC_DEPTH || !RUNTIME_FOLDERS.has(part)).join("/");
const domainOf = (folder) => segments(folder).slice(0, SRC_DEPTH + 1).join("/");
const packageOf = (path) => segments(path)[1];
const isModuleFolder = (folder) => depthOf(folder) >= 2 && !isRuntime(folder);

function commonAncestor(folders) {
  let common = segments(folders[0]);
  for (const folder of folders.slice(1)) {
    const parts = segments(folder);
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  return common.join("/");
}

// ---------- rules over the in-memory graph ----------
// graph: { files: { [path]: { lines, barrel, exports?, privateFunctions? } }, edges: [[from, to]] }, where an edge
// means `from` uses a declaration that `to` declares, already resolved through barrels and re-exports.
function indexGraph(graph) {
  const files = new Map(Object.entries(graph.files));
  const code = [...files.keys()].filter((path) => !files.get(path).barrel).sort();
  const users = new Map(code.map((path) => [path, new Set()]));
  const uses = new Map(code.map((path) => [path, new Set()]));
  for (const [from, to] of graph.edges) {
    if (from === to || !users.has(from) || !users.has(to)) continue;
    users.get(to).add(from);
    uses.get(from).add(to);
  }
  const folders = new Set();
  for (const path of files.keys()) {
    for (let folder = dirOf(path); depthOf(folder) >= 0; folder = dirOf(folder)) folders.add(folder);
  }
  const directFiles = new Map();
  for (const path of code) {
    const owner = ownerOf(dirOf(path));
    if (!directFiles.has(owner)) directFiles.set(owner, []);
    directFiles.get(owner).push(path);
  }
  return { files, code, users, uses, folders: [...folders].sort(), directFiles };
}

function moduleViolations(index, module) {
  const { files, code, users, uses, directFiles } = index;
  const found = [];
  const add = (rule, path, message) => found.push({ rule, path, message });
  if (!files.has(`${module}/index.ts`)) add("no-index", module, "the module has no index.ts; add one that exports only what other folders use.");
  const members = code.filter((path) => isInside(path, module));
  if (members.length > 0 && !members.some((path) => [...users.get(path)].every((user) => isInside(user, module)))) {
    add("hides-nothing", module, "every file is used from outside, so the folder is a label, not a package; fold its files into the parent folder, or stop using its internals from outside.");
  }
  const direct = directFiles.get(module) ?? [];
  if (direct.length >= 2) {
    const memberSet = new Set(direct);
    for (const path of direct) {
      const linked = [...users.get(path), ...uses.get(path)].some((other) => other !== path && memberSet.has(other));
      if (!linked) add("orphan-file", path, "no other file of its module uses it or is used by it; move the file to where its users are.");
    }
  }
  const outsideUsers = new Set(members.flatMap((path) => [...users.get(path)].filter((user) => !isInside(user, module))));
  const parent = parentOf(module);
  const near = [...outsideUsers].filter((user) => packageOf(user) === packageOf(module) && domainOf(dirOf(user)) === domainOf(module));
  if (near.length > 0) {
    const lca = commonAncestor(near.map((user) => stripRuntime(dirOf(user))));
    const strippedParent = stripRuntime(parent);
    if (lca !== strippedParent && isInside(strippedParent, lca)) add("misplaced", module, `its users sit outside the parent folder; move the folder up to ${lca}.`);
  }
  const parentFiles = new Set(directFiles.get(parent) ?? []);
  const usesParent = members.some((path) => [...uses.get(path)].some((used) => parentFiles.has(used)));
  if (usesParent && [...parentFiles].some((path) => [...uses.get(path)].some((used) => isInside(used, module)))) {
    add("cycle-with-parent", module, `the module and files directly in ${parent} use each other; move the shared code into the module or out of both.`);
  }
  return found;
}

function sharedExports(files) {
  const names = new Map();
  for (const shared of SHARED_MODULES) {
    const index = files.get(`${shared}/index.ts`);
    const exported = index ? [index] : [...files].filter(([path]) => isInside(path, shared)).map(([, file]) => file);
    for (const file of exported) for (const name of file.exports ?? []) names.set(name, shared);
  }
  return names;
}

function latentModules(index) {
  const { users, uses, directFiles } = index;
  const warnings = [];
  for (const [folder, direct] of directFiles) {
    const inFolder = new Set(direct);
    const seen = new Set();
    for (const start of direct) {
      if (seen.has(start)) continue;
      const component = [];
      const queue = [start];
      seen.add(start);
      while (queue.length > 0) {
        const path = queue.pop();
        component.push(path);
        for (const other of [...users.get(path), ...uses.get(path)]) {
          if (inFolder.has(other) && !seen.has(other)) {
            seen.add(other);
            queue.push(other);
          }
        }
      }
      if (component.length < 3 || component.length === direct.length) continue;
      const inComponent = new Set(component);
      const entries = component.filter((path) => [...users.get(path)].some((user) => !inComponent.has(user)));
      if (entries.length > 2) continue;
      const names = component.sort().map((path) => path.slice(folder.length + 1)).join(", ");
      warnings.push({
        rule: "latent-module",
        path: folder,
        message: `${names} form a package; move them into a subfolder of ${folder} with an index.ts exporting only ${entries.length > 0 ? entries.map((path) => path.slice(folder.length + 1)).join(" and ") : "what other folders use"}.`,
      });
    }
  }
  return warnings;
}

/** All rule violations and warnings of a graph, sorted by rule and path. */
export function findViolations(graph) {
  const index = indexGraph(graph);
  const { files, code, users } = index;
  const violations = index.folders.filter(isModuleFolder).flatMap((module) => moduleViolations(index, module));
  for (const path of code) {
    const fileUsers = [...users.get(path)];
    if (files.get(path).lines < SATELLITE_LINES && fileUsers.length === 1 && dirOf(fileUsers[0]) === dirOf(path)) {
      violations.push({ rule: "satellite", path, message: `a short file with one user next to it; fold it into ${fileUsers[0]}.` });
    }
  }
  const shared = sharedExports(files);
  for (const path of code) {
    const copies = (files.get(path).privateFunctions ?? []).filter((name) => shared.has(name));
    if (copies.length > 0) {
      violations.push({ rule: "shared-name", path, message: copies.map((name) => `import ${name} from ${shared.get(name)}`).join("; ") + " instead of re-declaring it." });
    }
  }
  const order = (a, b) => RULES.indexOf(a.rule) - RULES.indexOf(b.rule) || a.path.localeCompare(b.path);
  return { violations: violations.sort(order), warnings: latentModules(index).sort(order) };
}

export const keyOf = (violation) => `${violation.rule} ${violation.path}`;

/** Splits violations into new failures and baselined ones, and lists baseline entries that no longer fail. */
export function checkBaseline(violations, baseline) {
  const listed = new Set(baseline);
  const current = new Set(violations.map(keyOf));
  return {
    failures: violations.filter((violation) => !listed.has(keyOf(violation))),
    stale: baseline.filter((entry) => !current.has(entry)),
    baselined: violations.filter((violation) => listed.has(keyOf(violation))).length,
  };
}

// ---------- graph from the TypeScript program ----------
const isBarrelFile = (ts, path, sf) =>
  /\/index\.tsx?$/.test(path) && sf.statements.every((statement) => ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement));

const hasExportModifier = (ts, node) => (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;

function privateFunctions(ts, sf) {
  const exportedLocally = new Set();
  for (const statement of sf.statements) {
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) exportedLocally.add((element.propertyName ?? element.name).text);
    }
  }
  const names = [];
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && !hasExportModifier(ts, statement)) names.push(statement.name.text);
    if (ts.isVariableStatement(statement) && !hasExportModifier(ts, statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (ts.isIdentifier(declaration.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) names.push(declaration.name.text);
      }
    }
  }
  return names.filter((name) => !exportedLocally.has(name));
}

/** Builds the file graph of every product file from one TypeScript program over all packages. */
export async function loadGraph(repoRoot = root) {
  const { ts, listFiles } = await import("../codemods/shared.mjs");
  const paths = listFiles(repoRoot, PACKAGES.map((pkg) => `packages/${pkg}/src`))
    .filter((path) => isProductPath(path) && existsSync(join(repoRoot, path)));
  const pathOf = new Map(paths.map((path) => [resolve(repoRoot, path), path]));
  const program = ts.createProgram({
    rootNames: [...pathOf.keys()],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve,
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    },
  });
  const checker = program.getTypeChecker();
  const productOf = (sf) => (sf ? pathOf.get(resolve(sf.fileName)) : undefined);
  const sharedPrefixes = SHARED_MODULES.map((folder) => `${folder}/`);
  const files = {};
  const edges = [];

  for (const sf of program.getSourceFiles()) {
    const path = productOf(sf);
    if (!path) continue;
    const barrel = isBarrelFile(ts, path, sf);
    const file = { lines: sf.getLineAndCharacterOfPosition(sf.end).line + (sf.text.endsWith("\n") ? 0 : 1), barrel };
    if (sharedPrefixes.some((prefix) => path.startsWith(prefix))) {
      const symbol = checker.getSymbolAtLocation(sf);
      file.exports = symbol ? checker.getExportsOfModule(symbol).map((exported) => exported.name) : [];
    }
    files[path] = file;
    if (barrel) continue;
    file.privateFunctions = privateFunctions(ts, sf);

    const targets = new Set();
    const declaringFiles = (symbol) => {
      let target = symbol;
      // TRAP: getAliasedSymbol throws on aliases it cannot resolve, such as an import of a missing name.
      if (target && target.flags & ts.SymbolFlags.Alias) {
        try {
          target = checker.getAliasedSymbol(target);
        } catch {
          return;
        }
      }
      for (const declaration of target?.declarations ?? []) {
        const declaringFile = productOf(declaration.getSourceFile());
        if (declaringFile) targets.add(declaringFile);
      }
    };
    const moduleFile = (specifier) => {
      const symbol = specifier && checker.getSymbolAtLocation(specifier);
      const declaration = symbol?.valueDeclaration;
      return declaration && ts.isSourceFile(declaration) ? productOf(declaration) : undefined;
    };
    const namespaces = new Set();
    for (const statement of sf.statements) {
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.name) declaringFiles(checker.getSymbolAtLocation(clause.name));
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
        else if (bindings) for (const element of bindings.elements) declaringFiles(checker.getSymbolAtLocation(element.name));
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) declaringFiles(checker.getSymbolAtLocation(element.name));
        } else {
          const target = moduleFile(statement.moduleSpecifier);
          if (target) targets.add(target);
        }
      }
    }
    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text)) {
        declaringFiles(checker.getSymbolAtLocation(node.name));
      } else if (ts.isQualifiedName(node) && ts.isIdentifier(node.left) && namespaces.has(node.left.text)) {
        declaringFiles(checker.getSymbolAtLocation(node.right));
      } else if (ts.isImportTypeNode(node)) {
        if (node.qualifier) declaringFiles(checker.getSymbolAtLocation(ts.isQualifiedName(node.qualifier) ? node.qualifier.right : node.qualifier));
        else {
          const target = moduleFile(node.argument.literal);
          if (target) targets.add(target);
        }
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0]) {
        const target = moduleFile(node.arguments[0]);
        if (target) targets.add(target);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    for (const target of targets) if (target !== path) edges.push([path, target]);
  }
  return { files, edges };
}

// ---------- CLI ----------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const update = process.argv.includes("--update");
  const { violations, warnings } = findViolations(await loadGraph());
  if (update) {
    writeFileSync(BASELINE, `${JSON.stringify([...new Set(violations.map(keyOf))].sort(), null, 2)}\n`);
    console.log(`modules: baseline rewritten with ${violations.length} violations, ${warnings.length} warnings`);
    process.exit(0);
  }
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : [];
  const { failures, stale, baselined } = checkBaseline(violations, baseline);
  for (const violation of failures) console.error(`${keyOf(violation)}: ${violation.message}`);
  for (const entry of stale) console.error(`${entry}: the baseline entry no longer fails; remove it: node scripts/lint/modules.mjs --update`);
  for (const warning of warnings) console.error(`warning ${keyOf(warning)}: ${warning.message}`);
  const counts = RULES.map((rule) => `${rule} ${violations.filter((violation) => violation.rule === rule).length}`).join(", ");
  console.log(`modules: ${failures.length} failing, ${stale.length} stale, ${baselined} baselined (${counts}), ${warnings.length} warnings`);
  process.exit(failures.length + stale.length > 0 ? 1 : 0);
}
