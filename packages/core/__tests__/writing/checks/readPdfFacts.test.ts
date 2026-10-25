/** Verifies the PDF facts are read from bytes fetched through the file-system port and the pdf.js task is released. */
import type { PdfjsLoader } from "../../../src/import/index";
import { readPdfFacts } from "../../../src/writing/checks";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

function loaderFor(received: { data?: Uint8Array }) {
  const destroy = jest.fn(async () => undefined);
  const page = {
    getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
    getTextContent: async () => ({ items: [] }),
    commonObjs: { has: () => false, get: () => undefined },
  };
  const document = { numPages: 2, getPage: async () => page, getMetadata: async () => ({ info: { Author: "Jane", Trapped: 3 } }) };
  const loader = {
    load: async () => ({ OPS: {} }),
    getDocument: async (source: { data: Uint8Array }) => { received.data = source.data; return { promise: Promise.resolve(document), destroy }; },
  } as unknown as PdfjsLoader;
  return { loader, destroy };
}

describe("readPdfFacts", () => {
  it("reads the PDF bytes through the port, keeps text info fields and destroys the task", async () => {
    const fs = new MemoryLibraryFs();
    await fs.writeFile("/p/out.pdf", new Uint8Array([1, 2, 3]));
    const received: { data?: Uint8Array } = {};
    const { loader, destroy } = loaderFor(received);

    const facts = await readPdfFacts(fs, loader, "/p/out.pdf");

    expect([...received.data!]).toEqual([1, 2, 3]);
    expect(facts.pages).toHaveLength(2);
    expect(facts.info).toEqual({ Author: "Jane" });
    expect(destroy).toHaveBeenCalled();
  });

  it("rejects a missing PDF", async () => {
    await expect(readPdfFacts(new MemoryLibraryFs(), loaderFor({}).loader, "/p/missing.pdf")).rejects.toThrow(/ENOENT/);
  });
});
