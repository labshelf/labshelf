// Which finished downloads and tab addresses the PDF watcher looks at, and which it may fetch again.
import { canRefetch, isPdfDownload, looksLikePdfUrl } from "../../../src/background/import/pdfSignals";

describe("the download filter", () => {
  it("takes a download served as a PDF, whatever its file name", () => {
    expect(isPdfDownload({ url: "https://x.org/get?id=1", filename: "/Downloads/get", mime: "application/pdf" })).toBe(true);
  });

  it("takes a file saved with a .pdf name", () => {
    expect(isPdfDownload({ url: "https://x.org/f", filename: "/Downloads/Paper.PDF", mime: "application/octet-stream" })).toBe(true);
  });

  it("leaves other downloads alone", () => {
    expect(isPdfDownload({ url: "https://x.org/data.zip", filename: "/Downloads/data.zip", mime: "application/zip" })).toBe(false);
  });

  it("fetches again only web addresses, never blob:, data: or file:", () => {
    expect(canRefetch("https://x.org/a.pdf")).toBe(true);
    expect(canRefetch("blob:https://x.org/1234-5678")).toBe(false);
    expect(canRefetch("data:application/pdf;base64,JVBERi0=")).toBe(false);
    expect(canRefetch("file:///Users/me/a.pdf")).toBe(false);
  });
});

describe("the PDF tab guess", () => {
  it.each([
    "https://arxiv.org/pdf/1706.03762v7",
    "https://www.science.org/doi/pdf/10.1126/science.abc1234",
    "https://onlinelibrary.wiley.com/doi/epdf/10.1002/x.1",
    "https://host.example/files/paper.pdf?download=1",
  ])("takes %s", (url) => expect(looksLikePdfUrl(url)).toBe(true));

  it.each([
    "https://www.science.org/doi/10.1126/science.abc1234",
    "https://pdfs.example.com/about",
    "not a url",
  ])("skips %s", (url) => expect(looksLikePdfUrl(url)).toBe(false));
});
