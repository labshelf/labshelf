/** Scans Typst source for `=` headings and `#heading` calls, skipping comments and fenced raw blocks. */

export interface TypstHeading {
  level: number;
  title: string;
  /** Zero-based line of the heading. */
  line: number;
}

const MARKER_HEADING = /^[ \t]*(=+)[ \t]+(\S.*)$/;
const CALL_HEADING = /^[ \t]*#heading(?:\([ \t]*level:[ \t]*(\d+)[ \t]*\))?\[([^\]]*)\]/;
const FENCE_OPEN = /^[ \t]*(`{3,})/;
const TRAILING_LABEL = /\s*<[\p{L}\p{N}_:.-]+>$/u;

interface ScanState { commentDepth: number; fenceLength: number }

/** Returns the line without comments, updating the block-comment depth that carries to the next line. */
function stripComments(line: string, state: ScanState): string {
  let code = "";
  for (let i = 0; i < line.length; i++) {
    const pair = line.slice(i, i + 2);
    if (pair === "/*") { state.commentDepth++; i++; code += " "; continue; }
    if (state.commentDepth > 0) {
      if (pair === "*/") { state.commentDepth--; i++; }
      continue;
    }
    // TRAP: `//` right after `:` belongs to a URL such as https://x.org, not a line comment.
    if (pair === "//" && line[i - 1] !== ":") { break; }
    code += line[i];
  }
  return code;
}

function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().replace(TRAILING_LABEL, "");
}

function headingOf(code: string, line: number): TypstHeading | undefined {
  const marker = MARKER_HEADING.exec(code);
  const call = marker ? undefined : CALL_HEADING.exec(code);
  const level = marker ? marker[1]!.length : Number(call?.[1] ?? 1);
  const title = cleanTitle(marker?.[2] ?? call?.[2] ?? "");
  return title && level > 0 ? { level, title, line } : undefined;
}

/** Headings in text order. */
export function scanTypstHeadings(text: string): TypstHeading[] {
  const state: ScanState = { commentDepth: 0, fenceLength: 0 };
  const headings: TypstHeading[] = [];
  text.split("\n").forEach((line, index) => {
    if (state.fenceLength > 0) {
      const closing = FENCE_OPEN.exec(line)?.[1];
      if (closing && closing.length >= state.fenceLength) { state.fenceLength = 0; }
      return;
    }
    const fence = state.commentDepth === 0 ? FENCE_OPEN.exec(line)?.[1] : undefined;
    // A fence closed on its own line is inline raw text, not a block.
    if (fence && !line.slice(line.indexOf(fence) + fence.length).includes(fence)) { state.fenceLength = fence.length; return; }
    const heading = headingOf(stripComments(line, state), index);
    if (heading) { headings.push(heading); }
  });
  return headings;
}
