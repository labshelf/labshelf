/** The Typst scanner of the prose ranges. */
import { lineEnd } from "../../text/index.js";
import { type RangeCollector, urlLength } from "./proseRanges.js";

const TYPST_LINE_KEYWORDS = new Set(["let", "set", "show", "import", "include", "if", "for", "while", "return", "context"]);

/** Walks Typst markup, code and content; prose is the markup outside code, math, raw, comments, labels and refs. */
export class TypstScanner {
  private proseFrom = 0;

  constructor(private readonly text: string, private readonly limit: number, private readonly out: RangeCollector) {}

  run(): void {
    const end = this.markup(0, false);
    this.out.add(this.proseFrom, Math.min(end, this.limit));
  }

  /** Ends the prose run at `from` and resumes it at `to`, which it returns. */
  private cut(from: number, to: number): number {
    this.out.add(this.proseFrom, from);
    this.proseFrom = to;
    return to;
  }

  /** Scans markup from `start`; inside content it stops past the `]` that closes it. */
  private markup(start: number, inContent: boolean): number {
    const text = this.text;
    let i = start;
    let depth = 0;
    while (i < text.length && (inContent || i < this.limit)) {
      const char = text[i];
      const url = urlLength(text, i);
      if (url > 0) i = this.cut(i, i + url);
      else if (char === "]" && inContent && depth === 0) return this.cut(i, i + 1);
      else if (char === "]" && inContent) { depth--; i++; }
      else if (char === "[") { depth++; i++; }
      else if (char === "/" && text[i + 1] === "/") i = this.cut(i, lineEnd(text, i));
      else if (char === "/" && text[i + 1] === "*") i = this.cut(i, this.blockCommentEnd(i));
      else if (char === "\\") i = this.cut(i, Math.min(text.length, i + 2));
      else if (char === "$") i = this.cut(i, this.mathEnd(i));
      else if (char === "`") i = this.cut(i, this.rawEnd(i));
      else if (char === "<" || char === "@") {
        const mark = (char === "<" ? /^<[\w:.-]+>/ : /^@[\w:.-]*\w/).exec(text.slice(i, i + 200))?.[0];
        i = mark === undefined ? i + 1 : this.cut(i, i + mark.length);
      } else if (char === "#" && /[A-Za-z_({[]/.test(text[i + 1] ?? "")) i = this.hashEnd(i);
      else i++;
    }
    return i;
  }

  /** Code after `#`: a keyword line, a block or group, or an identifier chain with its arguments and content. */
  private hashEnd(hash: number): number {
    const text = this.text;
    let i = this.cut(hash, hash + 1);
    const ident = /^[A-Za-z_][\w-]*/.exec(text.slice(i, i + 80))?.[0];
    if (ident !== undefined && TYPST_LINE_KEYWORDS.has(ident)) return this.code(this.cut(i, i + ident.length), "line");
    if (ident === undefined) {
      const open = text[i];
      if (open === "{") return this.code(this.cut(i, i + 1), "}");
      if (open === "(") return this.code(this.cut(i, i + 1), ")");
      this.cut(i, i + 1);
      return this.markup(i + 1, true);
    }
    i = this.cut(i, i + ident.length);
    for (;;) {
      const char = text[i];
      if (char === "(") i = this.code(this.cut(i, i + 1), ")");
      else if (char === "[") { this.cut(i, i + 1); i = this.markup(i + 1, true); }
      else if (char === "." && /^\.[A-Za-z_]/.test(text.slice(i, i + 2))) {
        const member = /^\.[A-Za-z_][\w-]*/.exec(text.slice(i, i + 80))?.[0] ?? ".";
        i = this.cut(i, i + member.length);
      } else return i;
    }
  }

  /** Scans code until its closer (or the line end, unless a bracket stays open); content `[..]` inside is markup. */
  private code(start: number, closer: ")" | "}" | "line"): number {
    const text = this.text;
    const stack: string[] = [];
    let i = start;
    let codeFrom = start;
    while (i < text.length) {
      const char = text[i];
      if (char === "\n" && closer === "line" && stack.length === 0) break;
      if (char === '"') i = this.stringEnd(i);
      else if (char === "/" && text[i + 1] === "/") i = lineEnd(text, i);
      else if (char === "/" && text[i + 1] === "*") i = this.blockCommentEnd(i);
      else if (char === "$") i = this.mathEnd(i);
      else if (char === "`") i = this.rawEnd(i);
      else if (char === "[") {
        this.cut(codeFrom, i + 1);
        i = this.markup(i + 1, true);
        codeFrom = i;
      } else if (char === "(" || char === "{") { stack.push(char === "(" ? ")" : "}"); i++; }
      else if (char === ")" || char === "}") {
        if (stack.length > 0) { stack.pop(); i++; continue; }
        if (char === closer) { i++; break; }
        if (closer === "line") break;
        i++;
      } else i++;
    }
    this.cut(codeFrom, i);
    return i;
  }

  private stringEnd(start: number): number {
    const text = this.text;
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === "\\") i++;
      else if (text[i] === '"' || text[i] === "\n") return i + 1;
    }
    return text.length;
  }

  private blockCommentEnd(start: number): number {
    const text = this.text;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text.startsWith("/*", i)) { depth++; i++; }
      else if (text.startsWith("*/", i)) { depth--; i++; if (depth === 0) return i + 1; }
    }
    return text.length;
  }

  private mathEnd(start: number): number {
    const text = this.text;
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === "\\") i++;
      else if (text[i] === "$") return i + 1;
    }
    return text.length;
  }

  private rawEnd(start: number): number {
    const text = this.text;
    let n = 0;
    while (text[start + n] === "`") n++;
    if (n === 2) return start + 2;
    const fence = "`".repeat(n);
    const at = text.indexOf(fence, start + n);
    return at < 0 ? text.length : at + n;
  }
}
