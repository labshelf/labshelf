/** Splits a paper's PDF text at its references heading, which is where venue page limits stop counting. */

export interface PaperBody {
  /** Pages that hold body text: every page when no references heading is found. */
  contentPages: number;
  headingFound: boolean;
  /** Text lines of each page before the references heading. */
  pages: string[][];
}

const HEADING = /^(?:[A-Z]|\d+(?:\.\d+)*)?\.?\s*(?:references|bibliography|works cited)\s*$/i;
const PAGE_NUMBER = /^\s*\d*\s*$/;

/** Running headers and footers repeat on most pages; numbers are blanked so "Page 3" and "Page 4" count as one line. */
function repeatedLines(pages: string[][]): Set<string> {
  const counts = new Map<string, number>();
  for (const lines of pages) {
    for (const line of new Set(lines.map((text) => text.replace(/\d+/g, "#").trim()))) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, count]) => pages.length > 1 && count > pages.length / 2).map(([line]) => line));
}

function findHeading(pages: string[][]): { page: number; line: number } | undefined {
  for (const [page, lines] of pages.entries()) {
    const line = lines.findIndex((text) => HEADING.test(text.trim()));
    if (line >= 0) { return { page, line }; }
  }
  return undefined;
}

/** The page holding the heading counts when body text precedes the heading on it. */
export function derivePaperBody(pages: string[][]): PaperBody {
  const heading = findHeading(pages);
  if (heading === undefined) { return { contentPages: pages.length, headingFound: false, pages }; }
  const repeated = repeatedLines(pages);
  const before = pages[heading.page]!.slice(0, heading.line);
  const bodyBefore = before.some((text) => !PAGE_NUMBER.test(text) && !repeated.has(text.replace(/\d+/g, "#").trim()));
  return {
    contentPages: heading.page + (bodyBefore ? 1 : 0),
    headingFound: true,
    pages: [...pages.slice(0, heading.page), before],
  };
}
