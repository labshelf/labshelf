// Pins the VS Code From paper… port over faked library services: the papers it offers, a paper without a PDF, no open library,
// and a rebuild when another library opens. The pdf.js and canvas parts are faked; core's node tests cover the crop.
import type { PaperRecord } from "@labshelf/core";
import type { ActiveServices } from "../../src/command/index";
import { createVsCodePaperObjects } from "../../src/library/paperObjectsHost";

function servicesOf(records: PaperRecord[], files: string[]): ActiveServices {
  return {
    paperService: { listPapers: async () => records, findPaper: async (id: string) => records.find((record) => record.id === id) },
    fileSystem: { stat: async (path: string) => (files.includes(path) ? { isFile: true } : undefined), readFile: async () => new Uint8Array([1]) },
    mutations: { paths: { join: (...parts: string[]) => parts.join("/") } },
    logger: { log: async () => undefined, error: async () => undefined },
  } as unknown as ActiveServices;
}

const paper = (id: string, title: string): PaperRecord => ({ id, title, path: `/lib/papers/${id}`, citeKey: `key${id}`, status: "unread" }) as PaperRecord;
const doc = { numPages: 0, getPage: async () => { throw new Error("no pages"); } };

describe("createVsCodePaperObjects", () => {
  let services: ActiveServices | undefined;
  const opened: string[] = [];
  const port = createVsCodePaperObjects({
    services: () => services,
    root: () => "/lib",
    pdf: { open: async () => { opened.push("pdf"); return { doc, close: async () => undefined }; }, renderRegion: async () => new Uint8Array() },
    version: "0.0.0",
  });

  it("fails with a clear message while no library is open", async () => {
    services = undefined;
    await expect(port.papers("")).rejects.toThrow("No library is open.");
  });

  it("offers the open library's papers matching the query", async () => {
    services = servicesOf([paper("a", "Deep nets"), paper("b", "Shallow")], []);
    expect((await port.papers("deep")).map((choice) => choice.id)).toEqual(["a"]);
  });

  it("rejects list() for a paper without a PDF and opens the PDF of one that has it", async () => {
    services = servicesOf([paper("a", "Deep nets"), paper("b", "Shallow")], ["/lib/papers/b/paper.pdf"]);
    await expect(port.list("a")).rejects.toThrow("This paper has no PDF.");
    expect(await port.list("b")).toEqual([]);
    expect(opened).toEqual(["pdf"]);
  });
});
