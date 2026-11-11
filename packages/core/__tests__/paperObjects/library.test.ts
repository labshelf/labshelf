// Pins which library papers the From paper… picker offers and in what order, and the choice each record becomes.
import type { PaperRecord } from "../../src/model/index.js";
import { createLibraryPaperObjects, rankPaperChoices } from "../../src/paperObjects/index.js";

function paper(id: string, fields: Partial<PaperRecord> = {}): PaperRecord {
  return { id, title: `Paper ${id}`, path: `papers/${id}`, citeKey: `key${id}`, status: "unread", ...fields } as PaperRecord;
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

describe("createLibraryPaperObjects", () => {
  const logger = { log: async () => undefined, error: async () => undefined };
  const doc = { numPages: 0, getPage: async () => { throw new Error("no pages"); } };

  function library(list: PaperRecord[], hasPdf: (id: string) => boolean) {
    const closed: string[] = [];
    const opened: string[] = [];
    const port = createLibraryPaperObjects({
      records: async () => list,
      record: async (id) => list.find((record) => record.id === id),
      openPdf: async (record) => {
        if (!hasPdf(record.id)) return null;
        opened.push(record.id);
        return { doc, close: async () => { closed.push(record.id); } };
      },
      renderRegion: async () => new Uint8Array([1]),
      logger,
    });
    return { port, opened, closed };
  }

  it("answers papers(query) from the library's records", async () => {
    const { port } = library([paper("x", { title: "Deep nets" }), paper("y", { title: "Shallow" })], () => true);
    expect((await port.papers("deep")).map((choice) => choice.id)).toEqual(["x"]);
  });

  it("rejects list() with the picker's message for an unknown paper and for a paper without a PDF", async () => {
    const { port } = library([paper("nopdf")], () => false);
    await expect(port.list("nopdf")).rejects.toThrow("This paper has no PDF.");
    await expect(port.list("missing")).rejects.toThrow("This paper has no PDF.");
  });

  it("keeps the PDFs of the four most recently used papers open and closes the one it drops", async () => {
    const ids = ["a", "b", "c", "d", "e"];
    const { port, opened, closed } = library(ids.map((id) => paper(id)), () => true);
    for (const id of ids) await port.list(id);
    await new Promise((resolve) => setImmediate(resolve));
    expect(opened).toEqual(ids);
    expect(closed).toEqual(["a"]);
  });
});
