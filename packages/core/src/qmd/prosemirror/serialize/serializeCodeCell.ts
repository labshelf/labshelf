// Writes a code cell's fenced source, lengthening the fence when the cell's lines would close it.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";

function longestClosingRun(lines: string, fence: string): number {
  const char = fence[0] ?? "`";
  let longest = 0;
  for (const line of lines.split("\n")) {
    const run = /^(\S+) *$/.exec(line)?.[1];
    if (run && run.length >= fence.length && [...run].every((c) => c === char)) { longest = Math.max(longest, run.length); }
  }
  return longest;
}

/** Returns the cell's lines joined and ended with "\n". */
export function serializeCodeCell(node: Node): string {
  const { lang, options, code, fence, info, close } = node.attrs as {
    lang: string | null; options: string; code: string; fence: string; info: string | null; close: string | null;
  };
  const run = longestClosingRun(options + code, fence);
  const langInfo = lang ? `{${lang}}` : "";
  if (run > 0) {
    const longer = (fence[0] ?? "`").repeat(run + 1);
    return `${longer}${langInfo}\n${options}${code}${longer}\n`;
  }
  return `${fence}${info ?? langInfo}\n${options}${code}${close ?? fence}\n`;
}
