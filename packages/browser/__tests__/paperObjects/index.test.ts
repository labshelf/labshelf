/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Pins the library page's From paper… port: which papers the picker offers and in what order, a paper without a PDF,
// and an insert read from the arXiv source in the library's e-print cache, which carries the paper's cite key.
// The pdf.js and canvas parts (pages, region renders) are not run here: jsdom has neither a PDF worker nor a 2D canvas.
import { EPRINT_CACHE_DIR, type ILogger, type PaperRecord } from "@labshelf/core";
import { MemoryFolderFs } from "../storage/memoryFolderFs";

const records = new Map<string, PaperRecord>();
jest.mock("../../src/storage", () => ({
  listCachedPaperRecords: async () => [...records.values()],
  readCachedPaperRecord: async (id: string) => records.get(id),
}));
jest.mock("../../src/capture/pdfFinding", () => ({
  loadPdfjs: async () => { throw new Error("pdf.js is not loaded in tests"); },
}));

import { createBrowserPaperObjects, rankPaperChoices } from "../../src/paperObjects";

const logger: ILogger = { log: async () => undefined, error: async () => undefined };

function paper(id: string, fields: Partial<PaperRecord> = {}): PaperRecord {
  return { id, title: `Paper ${id}`, path: `papers/${id}`, citeKey: `key${id}`, status: "unread", ...fields } as PaperRecord;
}

function setRecords(list: PaperRecord[]): void {
  records.clear();
  for (const record of list) records.set(record.id, record);
}

describe("rankPaperChoices", () => {
  it("lists the most recently touched papers for an empty query, without trashed ones", () => {
    const list = [
      paper("a", { statusChangedAt: "2026-01-01T00:00:00Z" }),
      paper("b", { statusChangedAt: "2026-03-01T00:00:00Z" }),
      paper("c", { statusChangedAt: "2026-05-01T00:00:00Z", trashedAt: "2026-06-01T00:00:00Z" }),
      paper("d"),
    ];
    expect(rankPaperChoices(list, "  ").map((choice) => choice.id)).toEqual(["b", "a", "d"]);
  });

  it("maps a record to a choice: authors joined or shortened, year as text, no empty cite key", () => {
    const [few] = rankPaperChoices([paper("a", { authors: ["Ana", "Ben"], year: 2017 })], "");
    expect(few).toEqual({ id: "a", citeKey: "keya", title: "Paper a", authors: "Ana, Ben", year: "2017" });
    const [many] = rankPaperChoices([paper("b", { authors: ["Ana", "Ben", "Cy", "Dee"], citeKey: "" })], "");
    expect(many).toEqual({ id: "b", citeKey: null, title: "Paper b", authors: "Ana et al.", year: null });
  });

  it("ranks a title match above an author match and drops papers that do not match", () => {
    const list = [
      paper("author", { title: "Something else", authors: ["Attention Smith"] }),
      paper("title", { title: "Attention is all you need" }),
      paper("none", { title: "Unrelated" }),
      paper("trashed", { title: "Attention again", trashedAt: "2026-01-01T00:00:00Z" }),
    ];
    expect(rankPaperChoices(list, "attention").map((choice) => choice.id)).toEqual(["title", "author"]);
  });

  it("offers at most 50 papers", () => {
    const list = Array.from({ length: 60 }, (_, i) => paper(`p${i}`, { title: `Graph ${i}` }));
    expect(rankPaperChoices(list, "graph")).toHaveLength(50);
    expect(rankPaperChoices(list, "")).toHaveLength(50);
  });
});

describe("createBrowserPaperObjects", () => {
  it("answers papers(query) from the cached records", async () => {
    setRecords([paper("x", { title: "Deep nets" }), paper("y", { title: "Shallow" })]);
    const port = createBrowserPaperObjects({ fs: new MemoryFolderFs(), logger });
    expect((await port.papers("deep")).map((choice) => choice.id)).toEqual(["x"]);
  });

  it("rejects list() with the picker's message for an unknown paper and for a paper without a PDF", async () => {
    setRecords([paper("nopdf")]);
    const port = createBrowserPaperObjects({ fs: new MemoryFolderFs(), logger });
    await expect(port.list("nopdf")).rejects.toThrow("This paper has no PDF.");
    await expect(port.list("missing")).rejects.toThrow("This paper has no PDF.");
  });

  it("inserts a table read from the paper's arXiv source, linked to the paper's cite key", async () => {
    setRecords([paper("arx", { citeKey: "vaswani2017", title: "Attention", url: "https://arxiv.org/abs/1706.03762" })]);
    const fs = new MemoryFolderFs();
    const tex = [
      "\\documentclass{article}", "\\begin{document}",
      "\\begin{table}", "\\caption{Results}", "\\begin{tabular}{ll}", "Model & Score \\\\", "Base & 27.3 \\\\", "\\end{tabular}", "\\end{table}",
      "\\end{document}",
    ].join("\n");
    await fs.ensureDir(EPRINT_CACHE_DIR);
    await fs.writeFile(`${EPRINT_CACHE_DIR}/1706.03762`, new TextEncoder().encode(tex));
    const port = createBrowserPaperObjects({ fs, logger });
    const object = { kind: "table" as const, label: "1", page: 1, box: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 }, caption: "Results" };
    const insert = await port.insert("arx", object, { assetName: "t1", takenLabels: [] });
    expect(insert.via).toBe("arxiv");
    expect(insert.assets).toEqual([]);
    expect(insert.markdown).toContain("| Model | Score |");
    expect(insert.markdown).toContain("vaswani2017");
  });
});
