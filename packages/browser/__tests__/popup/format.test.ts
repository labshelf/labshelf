import { formatFolderName, formatMetaLine, parseTags } from "../../src/popup/format";

describe("popup format", () => {
  it("writes the byline with surnames, et al. past two", () => {
    expect(formatMetaLine({ authors: ["Alan Edelman", "Tomás A. Arias", "Steven T. Smith"], venue: "SIAM J. Matrix Anal. Appl.", year: 1998 }))
      .toBe("Edelman et al. · SIAM J. Matrix Anal. Appl. · 1998");
    expect(formatMetaLine({ authors: ["Alan Edelman", "Tomás A. Arias"], venue: "SIAM J." })).toBe("Edelman & Arias · SIAM J.");
    expect(formatMetaLine({ authors: ["A B", "C D", "E F", "G H"], year: 2001 })).toBe("B et al. · 2001");
    expect(formatMetaLine({ authors: [] })).toBe("");
  });

  it("parses comma separated tags, trimming and de-duplicating", () => {
    expect(parseTags(" ml, Thesis  ch2 ,ML;#survey,, ")).toEqual(["ml", "Thesis ch2", "survey"]);
    expect(parseTags("")).toEqual([]);
  });

  it("names folders by their path inside the library, the root as All papers", () => {
    expect(formatFolderName("papers")).toBe("All papers");
    expect(formatFolderName("papers/Thesis")).toBe("Thesis");
    expect(formatFolderName("papers/Thesis/Chapter 2")).toBe("Thesis / Chapter 2");
  });
});
