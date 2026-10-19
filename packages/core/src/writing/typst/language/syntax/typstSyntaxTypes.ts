// Declares what the Typst syntax scanner reports: the context at a cursor and the symbols a file defines.
import type { TypstMode } from "./walk/index.js";

export interface TypstCursorContext {
  mode: TypstMode;
  inComment: boolean;
  inRaw: boolean;
  /** The identifier fragment (letters, digits, `_`, `-`) that ends at the offset. */
  word: { from: number; text: string };
  /** The character just before `word` when it is one of these; "" otherwise. */
  trigger: "#" | "@" | "<" | "." | "";
  /** For trigger ".": the dotted path before the dot, e.g. "calc" or "math.attach". */
  receiver?: string;
  /** Inside a string literal: where its content starts and the content before the offset; `call` is the
   *  function or keyword the string is the first argument of ("image", "include", "import", "bibliography", …). */
  string?: { from: number; prefix: string; call?: string };
  /** The innermost unclosed call around the offset: the dotted callee and the named arguments already written. */
  call?: { callee: string; given: string[] };
}

export interface TypstBinding {
  name: string;
  from: number;
  to: number;
  line: number;
  topLevel: boolean;
  /** `let name(params) = …` as written, without the body; e.g. "let note(body, color: red)". */
  signature: string;
  params?: string[];
  /** The `///` lines right above, without the slashes, joined with "\n". */
  doc?: string;
}

export interface TypstLabelDefinition {
  name: string;
  from: number;
  to: number;
  line: number;
  /** The text on the label's line before it, trimmed. */
  context: string;
}

export interface TypstPathReference {
  path: string;
  from: number;
  to: number;
}

export interface TypstImport extends TypstPathReference {
  names: string[] | "*" | undefined;
  alias?: string;
}

export interface TypstFileSymbols {
  bindings: TypstBinding[];
  labels: TypstLabelDefinition[];
  imports: TypstImport[];
  includes: TypstPathReference[];
  bibliographies: TypstPathReference[];
}
