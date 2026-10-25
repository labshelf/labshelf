// Finds the name under a cursor and what it refers to: a binding, a library item, a label or a citation key.
import type { BibEntry } from "../../writing/bibliography/index.js";
import type { TypstBuiltin } from "./library/index.js";
import { findBuiltin } from "./builtinDocs.js";
import { importedSymbols, linkedLabels, projectBibEntries, type Located, type ProjectFiles } from "./project/index.js";
import { typstContextAt, type TypstBinding, type TypstLabelDefinition } from "./syntax/index.js";

const WORD_CHAR = /[\p{L}\p{N}_-]/u;

export type TypstSymbol =
  | { kind: "binding"; found: Located<TypstBinding> }
  | { kind: "builtin"; found: TypstBuiltin; name: string }
  | { kind: "label"; found: Located<TypstLabelDefinition> }
  | { kind: "citation"; found: Located<BibEntry> };

export interface TypstSymbolAt { from: number; to: number; symbol: TypstSymbol }

/** What the word around `offset` refers to; null for plain text, comments, raw text, strings and unknown names. */
export async function typstSymbolAt(files: ProjectFiles, offset: number): Promise<TypstSymbolAt | null> {
  const { text } = files.current;
  let from = offset;
  let to = offset;
  while (from > 0 && WORD_CHAR.test(text[from - 1]!)) { from--; }
  while (to < text.length && WORD_CHAR.test(text[to]!)) { to++; }
  if (from === to) { return null; }
  const context = typstContextAt(text, to);
  if (context.inComment || context.inRaw || context.string) { return null; }
  const name = text.slice(from, to);
  const symbol = context.mode === "markup" && (context.trigger === "@" || context.trigger === "<")
    ? await referenceSymbol(files, name, context.trigger === "@")
    : context.mode === "markup" ? null
    : context.trigger === "." ? await memberSymbol(files, context.receiver ?? "", name, context.mode === "math")
    : await nameSymbol(files, name, offset, context.mode === "math");
  return symbol ? { from, to, symbol } : null;
}

async function nameSymbol(files: ProjectFiles, name: string, offset: number, inMath: boolean): Promise<TypstSymbol | null> {
  const { current } = files;
  const named = current.symbols.bindings.filter((binding) => binding.name === name);
  // The last binding before the cursor is the one in scope; a later one is still the best guess for a forward use.
  const local = named.filter((binding) => binding.from <= offset).pop() ?? named[0];
  if (local) { return { kind: "binding", found: { item: local, file: current } }; }
  const imported = (await importedSymbols(files, current)).bindings.find(({ item }) => item.name === name);
  if (imported) { return { kind: "binding", found: imported }; }
  const builtin = findBuiltin(name, inMath);
  return builtin ? { kind: "builtin", found: builtin, name } : null;
}

async function memberSymbol(files: ProjectFiles, receiver: string, name: string, inMath: boolean): Promise<TypstSymbol | null> {
  const module = (await importedSymbols(files, files.current)).modules.find((candidate) => candidate.name === receiver);
  if (module) {
    const item = module.file.symbols.bindings.find((binding) => binding.topLevel && binding.name === name);
    return item ? { kind: "binding", found: { item, file: module.file } } : null;
  }
  const dotted = `${receiver}.${name}`;
  const builtin = findBuiltin(dotted, inMath);
  return builtin ? { kind: "builtin", found: builtin, name: dotted } : null;
}

async function referenceSymbol(files: ProjectFiles, name: string, withCitations: boolean): Promise<TypstSymbol | null> {
  const label = (await linkedLabels(files)).find(({ item }) => item.name === name);
  if (label) { return { kind: "label", found: label }; }
  if (!withCitations) { return null; }
  const entry = (await projectBibEntries(files)).find(({ item }) => item.key === name);
  return entry ? { kind: "citation", found: entry } : null;
}
