// Models the open brackets and `#` expressions of a Typst walk, and the calls they tell about.

export type TypstMode = "markup" | "code" | "math";

/** How far a `#` expression has got: it ends on its own when the next token cannot continue it. */
export type TypstEmbedState = "start" | "ident" | "after" | "statement" | "block";

export interface TypstFrame {
  mode: TypstMode;
  /** The character that closes the frame; "" for the file root and for `#` expressions. */
  closer: "" | "]" | "}" | ")" | "$";
  embed?: TypstEmbedState;
  /** Set on the parentheses of a call: the dotted path written right before them. */
  callee?: string;
  given: string[];
  /** Commas written so far at this frame's level. */
  args: number;
  /** Whether the current argument started with `name:`. */
  named: boolean;
  /** `import` or `include` when it is the last token, so the string after it belongs to it. */
  keyword?: string;
}

export interface TypstWalkEvents {
  /** An identifier in code; `topLevel` is false inside any bracket. */
  ident?(name: string, from: number, to: number, topLevel: boolean): void;
  /** A closed string literal in code: `from`/`to` bound its content; `call` as in `findStringCall`. */
  string?(content: string, from: number, to: number, call: string | undefined): void;
  /** A `<name>` label in markup: `from`/`to` bound the name. */
  label?(name: string, from: number, to: number): void;
}

export interface TypstWalkEnd {
  readonly stack: TypstFrame[];
  inComment: boolean;
  inRaw: boolean;
  /** Set when the text ends inside a string literal. */
  string?: { from: number; call: string | undefined };
}

export interface TypstWalk extends TypstWalkEnd {
  readonly text: string;
  readonly events: TypstWalkEvents;
  i: number;
  /** The dotted identifier path read last and the offset where it ends. */
  lastPath?: { text: string; end: number };
}

const ELSE = /[ \t]*else(?![\p{L}\p{N}_-])/uy;

export function openFrame(mode: TypstMode, closer: TypstFrame["closer"], callee?: string): TypstFrame {
  const frame: TypstFrame = { mode, closer, given: [], args: 0, named: false };
  if (callee !== undefined) { frame.callee = callee; }
  return frame;
}

export function openEmbed(): TypstFrame {
  return { ...openFrame("code", ""), embed: "start" };
}

/** Pops the top frame, whose closer the walk has just consumed, and lets a `#` expression around it go on or end. */
export function removeTopFrame(w: TypstWalk, closer: string): void {
  w.stack.pop();
  const parent = w.stack[w.stack.length - 1];
  if (!parent?.embed || parent.embed === "statement") { return; }
  if (parent.embed !== "block") { parent.embed = "after"; return; }
  if (closer !== "]" && closer !== "}") { return; }
  ELSE.lastIndex = w.i;
  if (!ELSE.test(w.text)) { w.stack.pop(); }
}

const isFirstArgument = (frame: TypstFrame): boolean => frame.args === 0 && !frame.named;

/** The call a string at the top of the stack is the first argument of, looking through an array literal. */
export function findStringCall(stack: readonly TypstFrame[]): string | undefined {
  const top = stack[stack.length - 1];
  if (top?.callee !== undefined) { return isFirstArgument(top) ? top.callee : undefined; }
  const parent = stack[stack.length - 2];
  if (top?.closer !== ")" || parent?.callee === undefined) { return undefined; }
  return isFirstArgument(parent) ? parent.callee : undefined;
}

/** The innermost call whose parentheses are open, without crossing out of code. */
export function findInnermostCall(stack: readonly TypstFrame[]): { callee: string; given: string[] } | undefined {
  for (let k = stack.length - 1; k >= 0; k--) {
    const frame = stack[k]!;
    if (frame.mode !== "code") { return undefined; }
    if (frame.callee !== undefined) { return { callee: frame.callee, given: [...frame.given] }; }
  }
  return undefined;
}
