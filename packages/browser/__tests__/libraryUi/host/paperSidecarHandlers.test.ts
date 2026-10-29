/** The library page host over the fake IndexedDB: reading stats and details from sidecars, tag and note edits, and annotation export. */
import type { HostToUi, PaperRecord, UiToHost } from "@labshelf/core";
import { clearFakeDb, putFile, textAt } from "../../support/fakeIdb";

jest.mock("idb", () => ({ openDB: async () => require("../../support/fakeIdb").fakeDb }));

const mockApi = {
  runtime: { sendMessage: jest.fn(async () => undefined), onMessage: { addListener: jest.fn(), removeListener: jest.fn() } },
  downloads: { download: jest.fn(async () => 1) },
};
jest.mock("../../../src/platform", () => ({
  bx: mockApi,
  watchVisibility: ({ onMessage }: { onMessage?: (m: unknown) => void }) => {
    if (onMessage) mockApi.runtime.onMessage.addListener(onMessage);
    return () => { if (onMessage) mockApi.runtime.onMessage.removeListener(onMessage); };
  },
  sendRuntime: async (message: never) => (mockApi.runtime.sendMessage as jest.Mock)(message),
  downloadTextFile: jest.fn(async () => undefined),
  createBrowserLogger: () => ({ log: async () => undefined, error: async () => undefined }),
}));
jest.mock("../../../src/capture", () => ({ attachPdfToPaper: jest.fn() }));
jest.mock("../../../src/libraryUi/reader/readerTabs", () => ({ openReader: jest.fn() }));

import { createLoopbackTransport } from "@labshelf/core";
import { downloadTextFile } from "../../../src/platform";
import { attachLibraryHost } from "../../../src/libraryUi/host";
import { writeCachedPaperRecord } from "../../../src/storage/records";

const PAPER: PaperRecord = { id: "smith2020", title: "A Paper", citeKey: "smith2020", path: "papers/smith2020", status: "unread", authors: ["Smith, Jane"], year: 2020 };
const METADATA = "title: A Paper\nstatus: unread\ncitekey: smith2020\nyear: 2020\nauthors:\n  - Smith, Jane\ntags: [old]\n";

const highlight = (id: string, page: number) => ({
  id, type: "highlight", pageNumber: page, content: `quote ${id}`, color: "yellow", position: { rects: [] }, createdAt: "2026-01-01T00:00:00.000Z",
});

function sidecar(annotations: unknown[], reading?: { page: number; updatedAt: string }): string {
  return JSON.stringify({ annotations, theme: "auto", ...(reading ? { reading: { scaleValue: "auto", ...reading } } : {}) });
}

async function seedLibrary(data: string): Promise<void> {
  putFile("papers/smith2020/metadata.yaml", METADATA);
  putFile("papers/smith2020/paper.pdf", new Uint8Array(2048));
  putFile(".research/papers/smith2020/data.json", data);
  await writeCachedPaperRecord({ ...PAPER, tags: ["old"], hasPdf: true }, PAPER.path);
}

const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0)); };

function start() {
  const { ui, host } = createLoopbackTransport();
  const received: HostToUi[] = [];
  ui.subscribe((m) => received.push(m));
  const listenersBefore = mockApi.runtime.onMessage.addListener.mock.calls.length;
  attachLibraryHost(host, { log: { log: async () => undefined, error: async () => undefined }, shareRelay: { requireRelay: async () => undefined, connectedRelay: async () => undefined } });
  const send = async (m: UiToHost): Promise<void> => { ui.post(m); await flush(); };
  const last = <T extends HostToUi["type"]>(type: T) => received.filter((m): m is Extract<HostToUi, { type: T }> => m.type === type).at(-1);
  // Delivers a runtime message to every listener this host registered, as the browser does.
  const runtime = (): ((msg: unknown) => void) => (msg) => {
    for (const [listener] of mockApi.runtime.onMessage.addListener.mock.calls.slice(listenersBefore)) (listener as (m: unknown) => void)(msg);
  };
  return { send, last, received, runtime };
}

beforeAll(() => {
  (globalThis as { document?: unknown }).document = { addEventListener: jest.fn(), removeEventListener: jest.fn(), visibilityState: "visible" };
});
afterAll(() => { delete (globalThis as { document?: unknown }).document; });
beforeEach(() => {
  clearFakeDb();
  jest.clearAllMocks();
});

describe("reading stats", () => {
  it("fills the snapshot's stats from the paper sidecars", async () => {
    await seedLibrary(sidecar([highlight("a", 1), highlight("b", 4)], { page: 4, updatedAt: "2026-03-01T10:00:00.000Z" }));
    const app = start();
    await app.send({ type: "ready" });
    expect(app.last("snapshot")?.snapshot.stats).toEqual({
      smith2020: { annotations: 2, lastPage: 4, lastRead: "2026-03-01T10:00:00.000Z" },
    });
  });

  it("leaves the stats of a paper with a corrupt sidecar empty and still lists the paper", async () => {
    await seedLibrary("{ not json");
    const app = start();
    await app.send({ type: "ready" });
    const snapshot = app.last("snapshot")!.snapshot;
    expect(snapshot.papers.map((p) => p.id)).toEqual(["smith2020"]);
    expect(snapshot.stats["smith2020"]).toEqual({ annotations: 0 });
  });
});

describe("paper.details", () => {
  it("answers with the annotations, the reading position and the PDF size", async () => {
    await seedLibrary(sidecar([highlight("a", 2)], { page: 2, updatedAt: "2026-03-01T10:00:00.000Z" }));
    const app = start();
    await app.send({ type: "ready" });
    await app.send({ type: "paper.details", id: "smith2020" });
    const details = app.last("details");
    expect(details?.id).toBe("smith2020");
    expect(details?.details.annotations.map((a) => a.id)).toEqual(["a"]);
    expect(details?.details.reading).toEqual({ page: 2, updatedAt: "2026-03-01T10:00:00.000Z" });
    expect(details?.details.pdf).toEqual({ size: 2048, relPath: "smith2020/paper.pdf" });
  });

  it("reports no PDF for a paper whose file is not on this device", async () => {
    await seedLibrary(sidecar([]));
    (await import("../../support/fakeIdb")).fakeFiles.delete("papers/smith2020/paper.pdf");
    const app = start();
    await app.send({ type: "ready" });
    await app.send({ type: "paper.details", id: "smith2020" });
    expect(app.last("details")?.details).toEqual({ annotations: [], reading: null, pdf: null, notes: [] });
  });
});

describe("tag and note edits", () => {
  it("writes tags to the paper folder, and posts the snapshot", async () => {
    await seedLibrary(sidecar([]));
    const app = start();
    await app.send({ type: "ready" });
    await app.send({ type: "paper.setTags", ids: ["smith2020"], add: [" fresh "], remove: ["old"] });
    expect(app.last("snapshot")?.snapshot.papers[0]?.tags).toEqual(["fresh"]);
    expect(textAt("papers/smith2020/metadata.yaml")).toMatch(/fresh/);
  });

  it("keeps the reading stats in the snapshot a tag edit posts", async () => {
    await seedLibrary(sidecar([highlight("a", 1)]));
    const app = start();
    await app.send({ type: "ready" });
    await app.send({ type: "paper.setTags", ids: ["smith2020"], add: ["x"], remove: [] });
    expect(app.last("snapshot")?.snapshot.stats["smith2020"]?.annotations).toBe(1);
  });

  it("adds, edits and removes a note in notes.qmd and shows the items in the details", async () => {
    await seedLibrary(sidecar([]));
    const app = start();
    await app.send({ type: "ready" });
    await app.send({ type: "paper.addNote", id: "smith2020", body: "Check the appendix" });
    const added = app.last("details")!;
    expect(added.details.notes?.map((n) => n.body.trim())).toEqual(["Check the appendix"]);
    expect(textAt(".research/papers/smith2020/notes.qmd")).toMatch(/Check the appendix/);
    expect(textAt("papers/smith2020/metadata.yaml")).not.toMatch(/Check the appendix/);
    const itemId = added.details.notes![0]!.id;
    await app.send({ type: "paper.editNote", id: "smith2020", itemId, body: "Check the proof" });
    expect(textAt(".research/papers/smith2020/notes.qmd")).toMatch(/Check the proof/);
    await app.send({ type: "paper.removeNote", id: "smith2020", itemId });
    expect(app.last("details")!.details.notes?.some((n) => n.id === itemId)).toBe(false);
    expect(textAt(".research/papers/smith2020/notes.qmd")).not.toMatch(/Check the/);
  });

  it("answers an error notice and writes no notes.qmd for a note on a paper that is not in the library", async () => {
    const app = start();
    await app.send({ type: "ready" });
    await app.send({ type: "paper.addNote", id: "ghost", body: "x" });
    expect(app.last("notice")).toMatchObject({ kind: "error" });
    expect((await import("../../support/fakeIdb")).fakeFiles.has(".research/papers/ghost/notes.qmd")).toBe(false);
  });
});

describe("annotations.export", () => {
  it("downloads the annotations as Markdown named after the cite key", async () => {
    await seedLibrary(sidecar([highlight("a", 3)]));
    const app = start();
    await app.send({ type: "ready" });
    await app.send({ type: "annotations.export", id: "smith2020" });
    const [name, markdown, mime] = (downloadTextFile as jest.Mock).mock.calls[0]!;
    expect(name).toBe("smith2020-annotations.md");
    expect(mime).toBe("text/markdown");
    expect(markdown).toMatch(/## Page 3/);
    expect(markdown).toMatch(/quote a/);
  });

  it("says so, and downloads nothing, for a paper without annotations", async () => {
    await seedLibrary(sidecar([]));
    const app = start();
    await app.send({ type: "ready" });
    await app.send({ type: "annotations.export", id: "smith2020" });
    expect(downloadTextFile).not.toHaveBeenCalled();
    expect(app.last("notice")).toMatchObject({ kind: "info" });
  });
});

describe("annotation changes made in the reader", () => {
  it("posts a snapshot with the paper's new stats", async () => {
    await seedLibrary(sidecar([highlight("a", 1)]));
    const app = start();
    await app.send({ type: "ready" });
    putFile(".research/papers/smith2020/data.json", sidecar([highlight("a", 1), highlight("b", 2)]));
    app.runtime()({ type: "library.changed", reason: "annotations", paperId: "smith2020" });
    await flush();
    expect(app.last("snapshot")?.snapshot.stats["smith2020"]?.annotations).toBe(2);
  });

  it("posts sidecarChanged alone when the paper's marks stay the same", async () => {
    await seedLibrary(sidecar([highlight("a", 1)]));
    const app = start();
    await app.send({ type: "ready" });
    const snapshots = app.received.filter((m) => m.type === "snapshot").length;
    putFile(".research/papers/smith2020/data.json", sidecar([{ ...highlight("a", 1), color: "green" }]));
    app.runtime()({ type: "library.changed", reason: "annotations", paperId: "smith2020" });
    await flush();
    expect(app.last("sidecarChanged")).toEqual({ type: "sidecarChanged", id: "smith2020" });
    expect(app.received.filter((m) => m.type === "snapshot")).toHaveLength(snapshots);
  });

  it("reads every sidecar again after a change made elsewhere", async () => {
    await seedLibrary(sidecar([]));
    const app = start();
    await app.send({ type: "ready" });
    putFile(".research/papers/smith2020/data.json", sidecar([highlight("a", 1)]));
    app.runtime()({ type: "library.changed", reason: "capture" });
    await flush();
    expect(app.last("snapshot")?.snapshot.stats["smith2020"]?.annotations).toBe(1);
  });

  it("shows the notice of a change the background made on its own, such as a watched tab's PDF", async () => {
    await seedLibrary(sidecar([]));
    const app = start();
    await app.send({ type: "ready" });
    app.runtime()({ type: "library.changed", reason: "attach", paperId: "smith2020", notice: 'PDF attached to "Smith"' });
    await flush();
    expect(app.last("notice")).toEqual({ type: "notice", kind: "ok", text: 'PDF attached to "Smith"' });
  });
});
