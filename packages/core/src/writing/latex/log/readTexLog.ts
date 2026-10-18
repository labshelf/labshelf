/** Reads a TeX transcript (.log) into its errors, warnings and bad boxes, each placed in the file and line it came from. */

type TexLogMessageKind = "error" | "warning" | "badbox";

export interface TexLogMessage {
  kind: TexLogMessageKind;
  /** The message as TeX wrote it, continuation lines joined, without the "! " or "X Warning: " prefix. */
  text: string;
  /** Who raised it: "LaTeX", "LaTeX Font", "Package hyperref", "Class article"; absent for TeX primitives. */
  source?: string;
  /** Path as the log names it, without a leading "./". */
  file?: string;
  line?: number;
  /** For errors: the source text up to the point where TeX stopped (the `l.<n>` line). */
  context?: string;
}

// PLATFORM: TeX Live breaks transcript lines at max_print_line, 79 characters by default.
const WRAP_WIDTH = 79;
const ERROR_CONTEXT_SEARCH = 20;

const FILE_LINE_ERROR = /^((?:[A-Za-z]:)?[^:\s()]*[^:\s()/\\]\.[A-Za-z]\w*):(\d+): (.+)$/;
const SOURCED = /^([A-Z][A-Za-z]*(?: [^\s:]+){0,2}) (Warning|Error): (.*)$/;
const BAD_BOX = /^(?:Over|Under)full \\[hv]box \(.*?\)(?:.*? at lines? (\d+))?/;
const CONTEXT_LINE = /^l\.(\d+) ?(.*)$/;
const INPUT_LINE = /on input line (\d+)/;
const CONTINUATION = /^\([A-Za-z@-]+\)(?:\s+(?=\S)|\s*$)/;

function unwrap(log: string): string[] {
  const lines: string[] = [];
  let pending = "";
  for (const line of log.split(/\r?\n/)) {
    pending += line;
    if (line.length === WRAP_WIDTH) { continue; }
    lines.push(pending);
    pending = "";
  }
  if (pending !== "") { lines.push(pending); }
  return lines;
}

function looksLikeFile(token: string): boolean {
  return /[/\\]/.test(token) || /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(token);
}

function normalizePath(token: string): string {
  return token.replace(/^\.\//, "");
}

/** Tracks the `(file … )` nesting TeX prints as it opens and closes input files. */
class FileStack {
  private readonly frames: (string | undefined)[] = [];

  scan(line: string): void {
    for (let i = 0; i < line.length; i++) {
      if (line[i] === ")") { this.frames.pop(); continue; }
      if (line[i] !== "(") { continue; }
      const token = /^[^\s()]*/.exec(line.slice(i + 1))![0];
      this.frames.push(looksLikeFile(token) ? normalizePath(token) : undefined);
      i += token.length;
    }
  }

  current(): string | undefined {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i] !== undefined) { return this.frames[i]; }
    }
    return undefined;
  }
}

/** Lines that continue a sourced message start with the padded source name, "(hyperref)   …" or "(Font)   …". */
function continuation(lines: string[], start: number): [string, number] {
  let text = "";
  let used = 0;
  while (start + used < lines.length && CONTINUATION.test(lines[start + used]!)) {
    text += ` ${lines[start + used]!.replace(CONTINUATION, "")}`;
    used++;
  }
  return [text, used];
}

function splitSource(text: string): { source?: string; text: string } {
  const match = SOURCED.exec(text);
  return match && match[2] === "Error" ? { source: match[1]!, text: match[3]! } : { text };
}

/** Reads an error starting at `start`; returns the message and the index of the last line it used. */
function readError(lines: string[], start: number, head: string, at: { file?: string; line?: number }): [TexLogMessage, number] {
  const { source, text } = splitSource(head.replace(/^(?:! )+/, ""));
  const [more, used] = source ? continuation(lines, start + 1) : ["", 0];
  const message: TexLogMessage = { kind: "error", text: (text + more).trim(), ...at };
  if (source) { message.source = source; }
  let end = start + used;
  for (let i = end + 1; i < Math.min(lines.length, end + ERROR_CONTEXT_SEARCH); i++) {
    const context = CONTEXT_LINE.exec(lines[i]!);
    if (!context) { continue; }
    message.line ??= Number(context[1]);
    message.context = context[2]!;
    end = i + 1;
    break;
  }
  return [message, end];
}

function readWarning(lines: string[], start: number, source: string, head: string, file: string | undefined): [TexLogMessage, number] {
  const [more, used] = continuation(lines, start + 1);
  const text = (head + more).replace(/\s+/g, " ").trim();
  const message: TexLogMessage = { kind: "warning", source, text };
  if (file) { message.file = file; }
  const line = INPUT_LINE.exec(text);
  if (line) { message.line = Number(line[1]); }
  return [message, start + used];
}

/** Skips the box contents TeX prints after a bad box, which may hold unbalanced parentheses from the text. */
function skipToBlank(lines: string[], start: number): number {
  let end = start;
  while (end + 1 < lines.length && lines[end + 1]!.trim() !== "") { end++; }
  return end;
}

export function readTexLog(log: string): TexLogMessage[] {
  const lines = unwrap(log);
  const files = new FileStack();
  const messages: TexLogMessage[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const file = files.current();
    const located = FILE_LINE_ERROR.exec(line);
    if (line.startsWith("! ") || located) {
      const at = located ? { file: normalizePath(located[1]!), line: Number(located[2]) } : file ? { file } : {};
      const [message, end] = readError(lines, i, located ? located[3]! : line, at);
      messages.push(message);
      i = end;
      continue;
    }
    const sourced = SOURCED.exec(line);
    if (sourced && sourced[2] === "Warning") {
      const [message, end] = readWarning(lines, i, sourced[1]!, sourced[3]!, file);
      messages.push(message);
      i = end;
      continue;
    }
    const badBox = BAD_BOX.exec(line);
    if (badBox) {
      messages.push({ kind: "badbox", text: line.trim(), ...(file ? { file } : {}), ...(badBox[1] ? { line: Number(badBox[1]) } : {}) });
      i = skipToBlank(lines, i);
      continue;
    }
    files.scan(line);
  }
  return messages;
}
