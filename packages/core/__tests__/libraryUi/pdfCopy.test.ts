import { findMissMessage, createNoPdfDialogCopy, formatPdfSourceLabel } from "../../src/libraryUi/pdfCopy";
import type { PdfMiss } from "../../src/libraryUi/protocol";

const miss = (over: Partial<PdfMiss> = {}): PdfMiss => ({ tried: 0, sources: [], blocked: false, needsLogin: false, ...over });

describe("pdfSourceLabel", () => {
  it("labels known resolvers, passes through unknown ones, falls back to the web", () => {
    expect(formatPdfSourceLabel("unpaywall")).toBe("Unpaywall (open access)");
    expect(formatPdfSourceLabel("publisher")).toBe("the publisher");
    expect(formatPdfSourceLabel("mystery")).toBe("mystery");
    expect(formatPdfSourceLabel(undefined)).toBe("the web");
  });
});

describe("noPdfDialogCopy", () => {
  it("summarises a normal miss with the source list and the paper title", () => {
    const { title, message } = createNoPdfDialogCopy("Deep Learning", miss({ tried: 7, sources: ["page", "publisher", "unpaywall"] }));
    expect(title).toBe("No PDF found");
    expect(message).toContain("Tried 7 links from this page, the publisher and Unpaywall (open access).");
    expect(message).toContain('"Deep Learning"');
    expect(message).toContain("without its PDF");
    expect(message).not.toContain("bot check");
  });

  it("uses the singular 'link' when exactly one was tried", () => {
    expect(createNoPdfDialogCopy("X", miss({ tried: 1, sources: ["page"] })).message).toContain("Tried 1 link from this page.");
  });

  it("says no identifier was found when nothing was tried", () => {
    const { message } = createNoPdfDialogCopy("Ghost", miss({ tried: 0 }));
    expect(message).toContain("No PDF link, DOI or arXiv id was found for \"Ghost\"");
    expect(message).not.toContain("Tried");
  });

  it("tells the user to open the page and sign in or pass the check when the miss has an access page", () => {
    const url = "https://publisher.example/x.pdf";
    expect(createNoPdfDialogCopy("X", miss({ tried: 1, needsLogin: true, access: { kind: "login", url } })).message).toContain("sign in there");
    expect(findMissMessage("X", miss({ tried: 1, blocked: true, access: { kind: "bot", url } }))).toContain("pass the check there");
  });

  it("adds the bot-check hint when some links were blocked", () => {
    expect(createNoPdfDialogCopy("X", miss({ tried: 3, sources: ["publisher"], blocked: true })).message)
      .toContain("behind a bot check");
  });
});


describe("findMissMessage", () => {
  it("counts the links tried, or says nothing was found to try, and adds the bot-check hint", () => {
    expect(findMissMessage("X", miss({ tried: 2 }))).toBe('LabShelf tried 2 links but could not download a PDF for "X". Attach a file you already have, or search again later.');
    expect(findMissMessage("X", miss())).toContain('LabShelf found no PDF link, DOI or arXiv id for "X".');
    expect(findMissMessage("X", miss({ tried: 1 }))).toContain("tried 1 link but");
    expect(findMissMessage("X", miss({ tried: 1, blocked: true }))).toContain("behind a bot check");
  });
});
