// Renames one exported symbol and every import and use of it, with the TypeScript language service.
// Usage: node scripts/codemods/renameSymbol.mjs <file> <oldName> <newName> [--dry-run] [--root <dir>]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listFiles, parseArgs, ts } from "./shared.mjs";

const SCAN_FOLDERS = ["packages", "website"];
const TS_FILE = /\.(ts|tsx|mts|cts)$/;

function createService(root) {
  const files = listFiles(root, SCAN_FOLDERS).filter((file) => TS_FILE.test(file) && !file.endsWith(".d.ts"));
  const names = files.map((file) => join(root, file));
  const host = {
    getScriptFileNames: () => names,
    getScriptVersion: () => "1",
    getScriptSnapshot: (file) => (existsSync(file) ? ts.ScriptSnapshot.fromString(readFileSync(file, "utf8")) : undefined),
    getCurrentDirectory: () => root,
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve,
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
    }),
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  };
  return ts.createLanguageService(host, ts.createDocumentRegistry());
}

function exportedNamePosition(service, file, name) {
  const program = service.getProgram();
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`${file} is not part of the project (packages/*, website)`);
  const moduleSymbol = program.getTypeChecker().getSymbolAtLocation(source);
  const exported = moduleSymbol && program.getTypeChecker().getExportsOfModule(moduleSymbol).find((symbol) => symbol.name === name);
  const declaration = exported?.declarations?.[0];
  const nameNode = declaration && ts.getNameOfDeclaration(declaration);
  if (!nameNode) throw new Error(`${file} does not export "${name}"`);
  return nameNode.getStart(declaration.getSourceFile());
}

const insideSpecifier = (source, position) => {
  let inSpecifier = false;
  const visit = (node) => {
    if (position < node.getStart(source) || position >= node.end) return;
    if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) inSpecifier = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return inSpecifier;
};

/** Renames the export `oldName` of `file` (repo-relative) to `newName`; returns the changed repo-relative files. */
export function renameSymbol({ root, file, oldName, newName, dryRun = false, log = console.log }) {
  const service = createService(root);
  const abs = join(root, file);
  const position = exportedNamePosition(service, abs, oldName);
  // Without prefix/suffix text the rename follows re-exports and imports to every consumer; with it, shorthand
  // properties (`{ sha }`) come back as `sha: newName`, which keeps object keys unchanged.
  const locations = service.findRenameLocations(abs, position, false, false, { providePrefixAndSuffixTextForRename: false });
  if (!locations || locations.length === 0) throw new Error(`The language service found nothing to rename for ${oldName}`);
  const withAffixes = service.findRenameLocations(abs, position, false, false, { providePrefixAndSuffixTextForRename: true }) ?? [];
  const affixAt = new Map(withAffixes.map((location) => [`${location.fileName}:${location.textSpan.start}`, location]));

  const byFile = new Map();
  for (const location of locations) {
    const edits = byFile.get(location.fileName) ?? [];
    const source = service.getProgram().getSourceFile(location.fileName);
    const affixed = affixAt.get(`${location.fileName}:${location.textSpan.start}`);
    const plain = !affixed || insideSpecifier(source, location.textSpan.start);
    edits.push({
      start: location.textSpan.start,
      end: location.textSpan.start + location.textSpan.length,
      text: plain ? newName : `${affixed.prefixText ?? ""}${newName}${affixed.suffixText ?? ""}`,
    });
    byFile.set(location.fileName, edits);
  }

  const changed = [];
  for (const [fileName, edits] of byFile) {
    let text = readFileSync(fileName, "utf8");
    for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    if (!dryRun) writeFileSync(fileName, text);
    changed.push(fileName.slice(root.length + 1));
  }
  log(`${oldName} -> ${newName}: ${locations.length} references in ${changed.length} files${dryRun ? " (dry run)" : ""}`);

  const leftovers = grepWord(root, oldName).filter((line) => !changed.includes(line.split(":")[0]));
  if (leftovers.length > 0 && !dryRun) {
    log(`Other files still mention "${oldName}" (JS files, docs, configs) - check by hand:`);
    for (const line of leftovers.slice(0, 50)) log(`  ${line}`);
    if (leftovers.length > 50) log(`  ... ${leftovers.length - 50} more`);
  }
  return { changed, leftovers };
}

function grepWord(root, word) {
  try {
    const output = execFileSync("git", ["grep", "-n", "-I", "-w", "-F", "-e", word, "--", ".", ":!pnpm-lock.yaml"], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    return output.toString("utf8").split("\n").filter(Boolean);
  } catch {
    return []; // git grep exits 1 when nothing matches
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { positional, options } = parseArgs(process.argv.slice(2));
  if (positional.length !== 3) {
    console.error("Usage: node scripts/codemods/renameSymbol.mjs <file> <oldName> <newName> [--dry-run] [--root <dir>]");
    process.exit(2);
  }
  try {
    renameSymbol({ root: options.root, file: positional[0], oldName: positional[1], newName: positional[2], dryRun: options.dryRun });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
