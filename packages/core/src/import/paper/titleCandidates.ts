// Lists the strings on a PDF's first page that could be the paper's title.

// Journal banners, dates and author lines surround the title, so only the opening of the page is read.
const EARLY_LINES = 30;
// A title wraps over at most this many lines.
const MAX_WRAPPED_LINES = 3;
// A line this long is body text, never a title.
const MAX_TITLE_CHARS = 300;

/** Every early line of the page, and every run of up to three adjacent early lines joined with a space. */
export function titleCandidates(firstPageText: string): string[] {
  const lines = firstPageText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .slice(0, EARLY_LINES);
  const out: string[] = [];
  for (let start = 0; start < lines.length; start++) {
    for (let count = 1; count <= MAX_WRAPPED_LINES && start + count <= lines.length; count++) {
      const joined = lines.slice(start, start + count).join(" ");
      if (joined.length <= MAX_TITLE_CHARS) out.push(joined);
    }
  }
  return out;
}
