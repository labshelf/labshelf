// Gathers what a Typst file sees across the project: imported bindings and modules, linked labels and bib entries.
import { parseBibEntries, type BibEntry } from "../../../writing/bibliography/index.js";
import type { TypstBinding, TypstLabelDefinition } from "../syntax/index.js";
import type { ProjectFile, ProjectFiles } from "./createProjectFiles.js";
import { resolveTypstPath } from "./projectPaths.js";

export interface Located<T> { item: T; file: ProjectFile }

export interface ProjectImports {
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
