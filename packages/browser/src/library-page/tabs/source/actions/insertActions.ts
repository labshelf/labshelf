// Prompts for a symbol or a table size and inserts it into the source editor.
import { MATH_SYMBOLS, MAX_TABLE_SIDE, parseTableSize, symbolSource, tableSnippet } from "@labshelf/core";
import { inputBox, quickPick, type QuickPickEntry } from "@labshelf/core/dom";
import type { SourceEdits, SourceLanguage } from "../../../editor/insert";

/** Every symbol as a pick item, a category heading before its first one. */
export function symbolEntries(language: SourceLanguage): QuickPickEntry<string>[] {
  const entries: QuickPickEntry<string>[] = [];
  let category: string | undefined;
  for (const symbol of MATH_SYMBOLS) {
    if (symbol.category !== category) {
      category = symbol.category;
      entries.push({ kind: "separator", label: category });
    }
    const source = symbolSource(symbol, language);
    entries.push({ label: symbol.glyph, description: source, value: source });
  }
  return entries;
}

export async function insertSymbol(edits: SourceEdits, language: SourceLanguage): Promise<void> {
  const source = await quickPick(symbolEntries(language), { title: "Insert Symbol", placeholder: "Search by name, e.g. alpha or arrow" });
  if (source !== undefined) edits.insertText(source);
}

export async function insertTable(edits: SourceEdits, language: SourceLanguage): Promise<void> {
  const answer = await inputBox({
    title: "Insert Table",
    prompt: "Columns x rows",
    value: "3x3",
    validate: (value) => (parseTableSize(value) ? null : `Enter columns x rows, each from 1 to ${MAX_TABLE_SIDE}, e.g. 3x2`),
  });
  const size = answer === undefined ? undefined : parseTableSize(answer);
  if (size) edits.insertSnippet(tableSnippet(language, size));
}
