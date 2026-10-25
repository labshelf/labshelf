/** Papers copy as comma-joined keys, blank-line-separated BibTeX or line-separated references, for every app. */
import { formatCitation, joinCitations } from "../../src/libraryUi/citationText";
import type { PaperRecord } from "../../src/model";

const paper = (citeKey: string, title: string): PaperRecord =>
  ({ id: citeKey, citeKey, title, authors: ["Ada Lovelace"], year: 1843, status: "unread", path: "/p" }) as unknown as PaperRecord;

const papers = [paper("lovelace1843", "Notes"), paper("babbage1837", "Engine")];

describe("joinCitations", () => {
  it("joins cite keys with commas, ready for a citation command", () => {
    expect(joinCitations(papers, "key")).toBe("lovelace1843,babbage1837");
  });

  it("separates BibTeX entries with a blank line and formatted references with a newline", () => {
    const bibtex = joinCitations(papers, "bibtex");
    expect(bibtex).toBe(`${formatCitation(papers[0]!, "bibtex")}\n\n${formatCitation(papers[1]!, "bibtex")}`);
    expect(bibtex).toContain("@");
    expect(joinCitations(papers, "apa").split("\n")).toHaveLength(2);
  });
});
