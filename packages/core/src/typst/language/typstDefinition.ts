// Finds where the Typst symbol or path string under a cursor is defined.
import { lineAt, resolveTypstPath, type ProjectFiles } from "./project/index.js";
import type { TypstDefinition } from "./typstLanguageSpec.js";
import { typstSymbolAt } from "./typstSymbolAt.js";

export async function typstDefinition(files: ProjectFiles, offset: number): Promise<TypstDefinition | null> {
  const { current } = files;
  const { imports, includes, bibliographies } = current.symbols;
  const reference = [...imports, ...includes, ...bibliographies].find((candidate) => candidate.from <= offset && offset <= candidate.to);
  if (reference) {
    const path = resolveTypstPath(current.path, reference.path);
    return path !== undefined && (await files.list()).includes(path) ? { path, from: 0, to: 0, line: 0 } : null;
  }
  const at = await typstSymbolAt(files, offset);
  if (!at) { return null; }
  const { symbol } = at;
  switch (symbol.kind) {
    case "builtin": return null;
    case "binding":
    case "label": {
      const { item, file } = symbol.found;
      return { path: file.path, from: item.from, to: item.to, line: item.line };
    }
    case "citation": {
      const { item, file } = symbol.found;
      const from = file.text.indexOf(item.key, item.start);
      return { path: file.path, from, to: from + item.key.length, line: lineAt(file.text, from) };
    }
  }
}
