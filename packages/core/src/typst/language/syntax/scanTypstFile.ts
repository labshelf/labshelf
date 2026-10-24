// Collects the bindings, labels, imports, includes and bibliographies a Typst file defines.
import { lineOf, lineStarts } from "../../../writing/lineIndex/index.js";
import { readImportNames } from "./typstImportNames.js";
import { readLetHead } from "./typstLetBinding.js";
import type { TypstBinding, TypstFileSymbols } from "./typstFileSymbols.js";
import { walkTypst } from "./typstWalk.js";

/** The symbols of `text`, each in the order it appears. */
export function scanTypstFile(text: string): TypstFileSymbols {
  const symbols: TypstFileSymbols = { bindings: [], labels: [], imports: [], includes: [], bibliographies: [] };
  const starts = lineStarts(text);
  walkTypst(text, {
    ident(name, from, to, topLevel) {
      if (name !== "let") { return; }
      const head = readLetHead(text, from, to);
      if (!head) { return; }
      const line = lineOf(starts, from);
      const binding: TypstBinding = { ...head, line, topLevel };
      const doc = docAbove(text, starts, line);
      if (doc !== undefined) { binding.doc = doc; }
      symbols.bindings.push(binding);
    },
    label(name, from, to) {
      const line = lineOf(starts, from);
      symbols.labels.push({ name, from, to, line, context: text.slice(starts[line], from - 1).trim() });
    },
    string(path, from, to, call) {
      if (call === "import") { symbols.imports.push({ path, from, to, ...readImportNames(text, to + 1) }); }
      if (call === "include") { symbols.includes.push({ path, from, to }); }
      if (call === "bibliography") { symbols.bibliographies.push({ path, from, to }); }
    },
  });
  return symbols;
}

/** The `///` lines right above `line`, without the slashes and one space, joined with "\n". */
function docAbove(text: string, starts: readonly number[], line: number): string | undefined {
  const lines: string[] = [];
  for (let k = line - 1; k >= 0; k--) {
    const content = text.slice(starts[k], starts[k + 1]! - 1).trim();
    if (!content.startsWith("///")) { break; }
    lines.unshift(content.replace(/^\/\/\/ ?/, ""));
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}
