// Builds the completion item of one library paper, with the shape the VS Code editor shows.
import type { Completion } from "@codemirror/autocomplete";
import type { PaperRecord } from "@labshelf/core";

/** `label` is what the typed text filters on: key, title and authors; the list shows the key and year. */
export function createCitationOption(paper: PaperRecord): Completion {
  const authors = paper.authors?.join(", ");
  return {
    label: [paper.citeKey, paper.title, authors].filter(Boolean).join(" "),
    displayLabel: [paper.citeKey, paper.year].filter((part) => part !== undefined).join(" "),
    detail: paper.title,
    info: [authors, paper.year].filter((part) => part !== undefined && part !== "").join(" "),
    apply: paper.citeKey,
    type: "text",
    // Library papers rank first, as in VS Code.
    boost: 1,
  };
}

/** The completion items of the library papers that have a cite key. */
export async function listLibraryCitations(papers: () => Promise<readonly PaperRecord[]>): Promise<Completion[]> {
  return (await papers()).filter((paper) => paper.citeKey !== "").map(createCitationOption);
}
