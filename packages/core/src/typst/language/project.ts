// Serves the project side of the Typst language service: per-request file reads, Typst paths and cross-file symbols.
import type { ILogger } from "../../ports/index.js";
import { parseBibEntries, type BibEntry } from "../../writing/citations/index.js";
import { scanTypstFile, type TypstBinding, type TypstFileSymbols, type TypstLabelDefinition } from "./syntax.js";

export interface TypstSources {
  /** Project-relative, `/`-separated paths of every project file. */
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
}

export interface ProjectFile { path: string; text: string; symbols: TypstFileSymbols }

export interface ProjectFiles {
  /** The file being edited, with its unsaved text. */
  current: ProjectFile;
  list(): Promise<string[]>;
  /** The file's text and, for a `.typ` file, its symbols; null when it cannot be read. */
  file(path: string): Promise<ProjectFile | null>;
}

const MODULE = "typstLanguage";
const EMPTY: TypstFileSymbols = { bindings: [], labels: [], imports: [], includes: [], bibliographies: [] };

/** A reader scoped to one request: nothing is kept between requests, so edits on disk are always seen. */
export function createProjectFiles(sources: TypstSources, logger: ILogger, path: string, text: string, action: string): ProjectFiles {
  const current: ProjectFile = { path, text, symbols: scanTypstFile(text) };
  const files = new Map<string, Promise<ProjectFile | null>>([[path, Promise.resolve(current)]]);
  let listing: Promise<string[]> | undefined;
  return {
    current,
    list() {
      listing ??= sources.list().catch((error: unknown) => {
        void logger.log("WARN", MODULE, "Could not list the project files; going on without them", { action, error: String(error) });
        return [];
      });
      return listing;
    },
    file(wanted) {
      let file = files.get(wanted);
      if (!file) {
        file = sources.read(wanted).then(
          (content) => ({ path: wanted, text: content, symbols: wanted.endsWith(".typ") ? scanTypstFile(content) : EMPTY }),
          (error: unknown) => {
            void logger.log("WARN", MODULE, "Could not read a project file; going on without it", { path: wanted, action, error: String(error) });
            return null;
          },
        );
        files.set(wanted, file);
      }
      return file;
    },
  };
}

/** The project path a Typst path string in `fromFile` names, or undefined for a package (`@preview/…`) or a path above the root. */
export function resolveTypstPath(fromFile: string, written: string): string | undefined {
  if (written.startsWith("@")) { return undefined; }
  const parts = written.startsWith("/") ? [] : folderOf(fromFile);
  for (const part of written.split("/")) {
    if (part === "..") {
      if (parts.length === 0) { return undefined; }
      parts.pop();
    } else if (part !== "." && part !== "") {
      parts.push(part);
    }
  }
  return parts.join("/");
}

/** How a file in `fromFile`'s folder writes the project path `target`. */
export function deriveRelativeTypstPath(fromFile: string, target: string): string {
  const from = folderOf(fromFile);
  const to = target.split("/");
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) { shared++; }
  return [...from.slice(shared).map(() => ".."), ...to.slice(shared)].join("/");
}

/** The 0-based line `offset` is on. */
export function deriveLineNumber(text: string, offset: number): number {
  let line = 0;
  for (let at = text.indexOf("\n"); at >= 0 && at < offset; at = text.indexOf("\n", at + 1)) { line++; }
  return line;
}

function folderOf(file: string): string[] {
  return file.split("/").slice(0, -1);
}

export interface Located<T> { item: T; file: ProjectFile }

interface ProjectImports {
  /** Names brought in by `import "f.typ": a, b` or `: *`. */
  bindings: Located<TypstBinding>[];
  /** `import "f.typ"` (as `alias`) brings the file in as a module named by its alias or file stem. */
  modules: { name: string; file: ProjectFile }[];
}

/** The `.typ` files `file` imports, with what each import brings in. */
export async function readImportedSymbols(files: ProjectFiles, file: ProjectFile): Promise<ProjectImports> {
  const result: ProjectImports = { bindings: [], modules: [] };
  for (const reference of file.symbols.imports) {
    const imported = await typstFile(files, file, reference.path);
    if (!imported) { continue; }
    const { names } = reference;
    if (names === undefined) {
      result.modules.push({ name: reference.alias ?? typstStem(imported.path), file: imported });
      continue;
    }
    for (const binding of imported.symbols.bindings) {
      if (binding.topLevel && (names === "*" || names.includes(binding.name))) { result.bindings.push({ item: binding, file: imported }); }
    }
  }
  return result;
}

/** Labels of the current file and of every file it includes or imports, transitively. */
export async function readLinkedLabels(files: ProjectFiles): Promise<Located<TypstLabelDefinition>[]> {
  const seen = new Set<string>();
  const labels: Located<TypstLabelDefinition>[] = [];
  const visit = async (file: ProjectFile): Promise<void> => {
    if (seen.has(file.path)) { return; }
    seen.add(file.path);
    labels.push(...file.symbols.labels.map((item) => ({ item, file })));
    for (const reference of [...file.symbols.includes, ...file.symbols.imports]) {
      const linked = await typstFile(files, file, reference.path);
      if (linked) { await visit(linked); }
    }
  };
  await visit(files.current);
  return labels;
}

/** Entries of every `.bib` file a `bibliography(…)` in any project `.typ` file names. */
export async function readProjectBibEntries(files: ProjectFiles): Promise<Located<BibEntry>[]> {
  const bibPaths = new Set<string>();
  const typFiles = (await files.list()).filter((path) => path.endsWith(".typ") && path !== files.current.path);
  for (const file of [files.current, ...await readAll(files, typFiles)]) {
    for (const reference of file.symbols.bibliographies) {
      const path = resolveTypstPath(file.path, reference.path);
      if (path?.endsWith(".bib")) { bibPaths.add(path); }
    }
  }
  const entries: Located<BibEntry>[] = [];
  for (const bib of await readAll(files, [...bibPaths])) { entries.push(...parseBibEntries(bib.text).map((item) => ({ item, file: bib }))); }
  return entries;
}

async function typstFile(files: ProjectFiles, from: ProjectFile, written: string): Promise<ProjectFile | null> {
  const path = resolveTypstPath(from.path, written);
  return path?.endsWith(".typ") ? files.file(path) : null;
}

async function readAll(files: ProjectFiles, paths: string[]): Promise<ProjectFile[]> {
  return (await Promise.all(paths.map((path) => files.file(path)))).filter((file): file is ProjectFile => file !== null);
}

function typstStem(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.typ$/, "");
}
