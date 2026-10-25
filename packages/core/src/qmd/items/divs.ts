// Finds the balanced fenced divs of Markdown lines, reading div and code fences as Pandoc does.
// CONTRACT: documents/contracts/qmd-items.md#items
import { findCodeFences } from "./fences.js";
import { isBlankLine, extractLineContent } from "./lines.js";

/** A top-level div: indices of its opening and closing lines. */
export interface DivRange { readonly open: number; readonly close: number }

type LineKind = "open" | "close" | "text";

const DIV_OPEN = /^:{3,}[ \t]*(?:\{.*\}|[^\s{:]\S*)[ \t]*:*[ \t]*$/;
const DIV_CLOSE = /^:{3,}[ \t]*$/;
const HEADING = /^#{1,6}(?:[ \t]|$)/;

/**
 * The top-level divs of `lines`. An opening line without a matching closing line is ordinary text and the scan
 * goes on after it, so one broken fence never hides the divs that follow.
 */
export function findTopLevelDivs(lines: readonly string[]): DivRange[] {
  const kinds = lineKinds(lines);
  const divs: DivRange[] = [];
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] !== "open") { continue; }
    const close = divClose(kinds, i);
    if (close !== undefined) {
      divs.push({ open: i, close });
      i = close;
    }
  }
  return divs;
}

/** Whether every div opened in `lines` closes inside it and no closing line is left over. */
export function isBalanced(lines: readonly string[]): boolean {
  let depth = 0;
  for (const kind of lineKinds(lines)) {
    if (kind === "close" && --depth < 0) { return false; }
    if (kind === "open") { depth += 1; }
  }
  return depth === 0;
}

function divClose(kinds: readonly LineKind[], open: number): number | undefined {
  let depth = 1;
  for (let i = open + 1; i < kinds.length; i++) {
    if (kinds[i] === "close" && --depth === 0) { return i; }
    if (kinds[i] === "open") { depth += 1; }
  }
  return undefined;
}

/**
 * Classifies each line; lines inside code fences are text. TRAP: in Pandoc a closing line ends a paragraph but an
 * opening line does not, so an opening line right after paragraph text is text.
 */
function lineKinds(lines: readonly string[]): LineKind[] {
  const fences = findCodeFences(lines);
  const fenceCloses = new Set(fences.values());
  const kinds: LineKind[] = [];
  for (let i = 0; i < lines.length; i++) {
    const fenceClose = fences.get(i);
    if (fenceClose !== undefined) {
      for (; i <= fenceClose; i++) { kinds.push("text"); }
      i -= 1;
      continue;
    }
    const content = extractLineContent(lines[i]!);
    if (DIV_CLOSE.test(content)) {
      kinds.push("close");
    } else if (DIV_OPEN.test(content) && startsBlock(lines, i, fenceCloses)) {
      kinds.push("open");
    } else {
      kinds.push("text");
    }
  }
  return kinds;
}

function startsBlock(lines: readonly string[], index: number, fenceCloses: ReadonlySet<number>): boolean {
  if (index === 0 || fenceCloses.has(index - 1)) { return true; }
  const previous = extractLineContent(lines[index - 1]!);
  return isBlankLine(previous) || DIV_CLOSE.test(previous) || DIV_OPEN.test(previous) || HEADING.test(previous);
}
