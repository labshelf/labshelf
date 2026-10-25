// Reads the alias and imported names written after the path string of a Typst `import`.
import { closingBracket, topLevelItems } from "./typstArgumentList.js";
import type { TypstImport } from "./typstFileSymbols.js";

const IDENT = "[\\p{L}_][\\p{L}\\p{N}_-]*";
const HEAD = new RegExp(`[ \\t]*(?:as[ \\t]+(${IDENT}))?[ \\t]*(:)?[ \\t]*`, "uy");
const RENAME = new RegExp(`\\s+as\\s+(${IDENT})$`, "u");

/** The names and alias of the import whose path string closes just before `afterQuote`. */
export function readImportNames(text: string, afterQuote: number): Pick<TypstImport, "names" | "alias"> {
  HEAD.lastIndex = afterQuote;
  const head = HEAD.exec(text);
  const alias = head?.[1];
  const names = head?.[2] === undefined ? undefined : nameList(text, HEAD.lastIndex);
  return alias === undefined ? { names } : { names, alias };
}

function nameList(text: string, start: number): string[] | "*" {
  if (text[start] === "*") { return "*"; }
  let list: string;
  if (text[start] === "(") {
    const close = closingBracket(text, start);
    list = text.slice(start + 1, close < 0 ? text.length : close);
  } else {
    const end = text.slice(start).search(/[\n;\]}]/);
    list = text.slice(start, end < 0 ? text.length : start + end);
  }
  return topLevelItems(list).map(importedName);
}

/** The name an import item binds: its rename, else the last segment of its dotted path. */
function importedName(item: string): string {
  return RENAME.exec(item)?.[1] ?? item.split(".").pop()!.trim();
}
