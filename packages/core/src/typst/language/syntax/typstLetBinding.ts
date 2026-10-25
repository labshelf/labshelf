// Reads the name, parameters and signature of a Typst `let` binding from the text after its keyword.
import { closingBracket, topLevelItems } from "./typstArgumentList.js";

export interface TypstLetHead {
  name: string;
  from: number;
  to: number;
  signature: string;
  params?: string[];
}

const NAME = /[ \t]+([\p{L}_][\p{L}\p{N}_-]*)/uy;

/** The head of the `let` keyword at `letFrom`..`letTo`; undefined for destructuring or a missing name. */
export function readLetHead(text: string, letFrom: number, letTo: number): TypstLetHead | undefined {
  NAME.lastIndex = letTo;
  const match = NAME.exec(text);
  if (!match) { return undefined; }
  const name = match[1]!;
  const to = NAME.lastIndex;
  const head = { name, from: to - name.length, to };
  const close = text[to] === "(" ? closingBracket(text, to) : -1;
  if (close < 0) { return { ...head, signature: text.slice(letFrom, to) }; }
  const params = topLevelItems(text.slice(to + 1, close)).map((item) => item.split(":")[0]!.trim());
  return { ...head, signature: text.slice(letFrom, close + 1).replace(/\s+/g, " "), params };
}
