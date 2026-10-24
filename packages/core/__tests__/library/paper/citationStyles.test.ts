import type { PaperRecord } from "../../../src/model/index";
import { formatCitations, formatDateTime, inTextCitation } from "../../../src/library/paper/index";

function paper(extra: Partial<PaperRecord> = {}): PaperRecord {
  return {
    id: "p", path: "papers/p", citeKey: "vaswani2017", status: "unread",
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
    year: 2017, journal: "NeurIPS", volume: "30", issue: "2", pages: "5998-6008", doi: "10.5555/3295222",
    ...extra,
  };
}

describe("inTextCitation", () => {
  it("names one, two or the first of many authors with the year", () => {
    expect(inTextCitation(paper({ authors: ["Ada Lovelace"] }))).toBe("Lovelace, 2017");
    expect(inTextCitation(paper({ authors: ["Ada Lovelace", "Charles Babbage"] }))).toBe("Lovelace & Babbage, 2017");
    expect(inTextCitation(paper())).toBe("Vaswani et al., 2017");
  });

  it("writes n.d. without a year and the title without authors", () => {
    expect(inTextCitation({ title: "Untitled Draft", authors: ["Ada Lovelace"] })).toBe("Lovelace, n.d.");
    expect(inTextCitation({ title: "Untitled Draft", authors: [" "], year: 2020 })).toBe("Untitled Draft, 2020");
  });

  it("keeps name particles with the family name", () => {
    expect(inTextCitation({ title: "Symphony", authors: ["Ludwig van Beethoven"], year: 1808 })).toBe("van Beethoven, 1808");
  });
});

describe("formatCitations", () => {
  it("writes APA 7 with initials, the ampersand, volume(issue), en-dash pages and the DOI link", () => {
    expect(formatCitations(paper()).apa).toBe(
      "Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention Is All You Need. NeurIPS, 30(2), 5998–6008. https://doi.org/10.5555/3295222",
    );
  });

  it("writes MLA 9 with et al. beyond two authors and the container fields", () => {
    expect(formatCitations(paper()).mla).toBe(
      "Vaswani, Ashish, et al. “Attention Is All You Need.” NeurIPS, vol. 30, no. 2, 2017, pp. 5998–6008. https://doi.org/10.5555/3295222.",
    );
  });

  it("writes Chicago author-date with the serial comma", () => {
    expect(formatCitations(paper()).chicago).toBe(
      "Vaswani, Ashish, Noam Shazeer, and Niki Parmar. 2017. “Attention Is All You Need.” NeurIPS 30 (2): 5998–6008. https://doi.org/10.5555/3295222.",
    );
  });

  it("leaves out what the record does not know", () => {
    const bare = formatCitations({ title: "Notes", authors: [] });
    expect(bare.apa).toBe("(n.d.). Notes.");
    expect(bare.mla).toBe("“Notes.”");
    expect(bare.chicago).toBe("n.d. “Notes.”");
    expect(bare.inText).toBe("Notes, n.d.");
  });
});

describe("formatDateTime", () => {
  it("is empty for a missing or broken timestamp", () => {
    expect(formatDateTime(undefined)).toBe("");
    expect(formatDateTime("not a date")).toBe("");
  });

  it("shows the date and the time", () => {
    const text = formatDateTime("2024-03-04T14:05:00");
    expect(text).toContain("Mar 4, 2024");
    expect(text).toMatch(/2:05\s?PM/);
  });
});
