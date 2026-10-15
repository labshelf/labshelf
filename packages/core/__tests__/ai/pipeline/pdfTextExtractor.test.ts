// The extractor turns PDF bytes into page text and sections, and logs a failed cleanup instead of swallowing it.
import { PdfTextExtractor } from "../../../src/ai/pipeline/pdfTextExtractor";

function openerOf(destroy: () => void | Promise<void>) {
  const document = {
    numPages: 2,
    getMetadata: async () => undefined,
    getPage: async (n: number) => ({ getTextContent: async () => ({ items: [{ str: `page   ${n}\ntext` }] }) }),
    destroy,
  };
  return { open: jest.fn(async () => document) };
}

const makeLogger = () => ({ log: jest.fn(async () => {}), error: jest.fn(async () => {}) });

describe("PdfTextExtractor", () => {
  it("returns the text of every page with its number", async () => {
    const opener = openerOf(() => undefined);
    const bytes = new Uint8Array([1]);

    const result = await new PdfTextExtractor(opener as never, makeLogger() as never).extract("p1", bytes);

    expect(opener.open).toHaveBeenCalledWith(bytes);
    expect(result.paperId).toBe("p1");
    expect(result.pages).toEqual([
      { page: 1, text: "page 1 text" },
      { page: 2, text: "page 2 text" },
    ]);
  });

  it("logs a failing destroy with the paper id and still returns the text", async () => {
    const logger = makeLogger();
    const opener = openerOf(() => { throw new Error("worker gone"); });

    const result = await new PdfTextExtractor(opener as never, logger as never).extract("p1", new Uint8Array([1]));

    expect(result.pages).toHaveLength(2);
    expect(logger.error).toHaveBeenCalledWith("ai/pdf", expect.objectContaining({ message: "worker gone" }), expect.objectContaining({ paperId: "p1" }));
  });
});
