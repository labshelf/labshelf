/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Tests the note tab's live mode (spec 4.2): a note tab whose source has a livePath binds mountNoteFile to the live file's replica doc,
// flushes then releases the live file when the tab closes or is disposed, falls back to the read-once mount when live files are
// unavailable, and the project note and paper notes tabs pass the library path of their notes file.
//
// Mocks as noteFileTab.test.ts does: @labshelf/core/dom's mountNoteFile (it records its options) and the helper; readPageLiveFiles is mocked
// at its module (storage/libraryFileSystem), where the tab sources import it.
// The project note tab (tabKinds mountNote) loads through a dynamic import, which this jest run cannot execute (noteFileTab.test.ts and
// projectNoteTab.test.ts hit the same limit), so its livePath wiring is not tested here.
// Assumptions the spec leaves open: the live option of mountNoteFile is { doc, persist } (spec 4.1); a paper's folder is readCachedPaperRecord(id).path.
import * as Y from "yjs";
import type { ILogger } from "@labshelf/core";
import { mountNoteFileTab, mountPaperNoteTab, type NoteFileSource } from "../../../src/libraryUi/editorArea/noteFileTab";
import type { TabContext } from "../../../src/libraryUi/editorArea/tabKinds";

const mockMounts: Array<Record<string, unknown>> = [];
const mockEvents: string[] = [];
const mockReadPageLiveFiles = jest.fn();

jest.mock("@labshelf/core/dom", () => ({
  ...jest.requireActual("@labshelf/core/dom"),
  mountNoteFile: (_el: HTMLElement, options: Record<string, unknown>) => {
    mockMounts.push(options);
    return { editors: [], update: () => undefined, destroy: () => { mockEvents.push("destroy"); } };
  },
}));
jest.mock("../../../src/helper", () => ({
  getBrowserCellPorts: () => ({ runCell: jest.fn(), runCellIn: () => jest.fn(), restartCell: jest.fn(), runMath: undefined, installPython: jest.fn() }),
}));
jest.mock("../../../src/storage/libraryFileSystem", () => ({
  ...jest.requireActual("../../../src/storage/libraryFileSystem"),
  readPageLiveFiles: (...args: unknown[]) => mockReadPageLiveFiles(...args),
}));
jest.mock("../../../src/storage", () => ({
  ...jest.requireActual("../../../src/storage"),
  createPaperNotesPort: () => ({}),
  readCachedPaperRecord: async (id: string) => (id === "paper-1" ? { path: "papers/2026/paper-1" } : undefined),
}));
jest.mock("@labshelf/core", () => {
  const actual = jest.requireActual("@labshelf/core");
  return { ...actual, PaperNotesStore: class { async read() { return { segments: [] }; } } };
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await wait(10);
}

/** A live file over a real Y.Doc; flush and release record their order in mockEvents. */
function fakeLive(options: { ready?: Promise<unknown> } = {}) {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, "from the replica");
  const replica = { key: "fake", kind: "text" as const, doc, ready: options.ready ?? Promise.resolve("disk"), text: () => doc.getText("content").toString(), release: () => undefined };
  const flush = jest.fn(async () => { mockEvents.push("flush"); });
  const release = jest.fn(async () => { mockEvents.push("release"); });
  const opened = { replica, flush, release };
  const liveFiles = { open: jest.fn((_path: string) => opened) };
  return { doc, flush, release, opened, liveFiles };
}

const logger: ILogger = { log: async () => undefined, error: jest.fn(async () => undefined) };

function context() {
  const closers: Array<() => unknown> = [];
  const ctx = {
    logger, fs: {}, tab: { setDirty: jest.fn(), onBeforeClose: jest.fn((fn: () => unknown) => { closers.push(fn); }) },
  } as unknown as TabContext;
  return { ctx, closers };
}

function source(extra: Partial<NoteFileSource> = {}) {
  const read = jest.fn(async (): Promise<string | null> => "disk text");
  const editItem = jest.fn(async (_id: string, _body: string) => undefined);
  const src: NoteFileSource = { label: "n.qmd", noteKey: "project:p1:notes/n.qmd", read, editItem, ...extra };
  return { src, read, editItem };
}

async function openTab(src: NoteFileSource) {
  mockMounts.length = 0;
  mockEvents.length = 0;
  const { ctx, closers } = context();
  const tab = mountNoteFileTab(document.createElement("div"), ctx, src);
  await until(() => mockMounts.length > 0);
  expect(mockMounts).toHaveLength(1);
  return { options: mockMounts[0]!, tab, closers, ctx };
}

beforeEach(() => {
  mockReadPageLiveFiles.mockReset();
  (logger.error as jest.Mock).mockClear();
});

describe("note tab live mode", () => {
  it("4.2a mounts the note over the replica's doc and does not read the file through the source", async () => {
    const live = fakeLive();
    mockReadPageLiveFiles.mockResolvedValue(live.liveFiles);
    const { src, read } = source({ livePath: "projects/alpha/notes/n.qmd" });
    const { options, tab } = await openTab(src);
    expect((options["live"] as { doc: Y.Doc }).doc).toBe(live.doc);
    expect(read).not.toHaveBeenCalled();
    tab.dispose();
  });

  it("4.2a opens the live file of the source's livePath", async () => {
    const live = fakeLive();
    mockReadPageLiveFiles.mockResolvedValue(live.liveFiles);
    const { src } = source({ livePath: "projects/alpha/notes/n.qmd" });
    const { tab } = await openTab(src);
    expect(live.liveFiles.open).toHaveBeenCalledWith("projects/alpha/notes/n.qmd");
    tab.dispose();
  });

  it("4.2a persists the live note through the live file's flush", async () => {
    const live = fakeLive();
    mockReadPageLiveFiles.mockResolvedValue(live.liveFiles);
    const { src } = source({ livePath: "projects/alpha/notes/n.qmd" });
    const { options, tab } = await openTab(src);
    await (options["live"] as { persist(): Promise<void> | void }).persist();
    expect(live.flush).toHaveBeenCalledTimes(1);
    tab.dispose();
  });

  it("4.2a keeps the tab clean while the live note is edited", async () => {
    const live = fakeLive();
    mockReadPageLiveFiles.mockResolvedValue(live.liveFiles);
    const { src } = source({ livePath: "projects/alpha/notes/n.qmd" });
    const { ctx, tab } = await openTab(src);
    live.doc.getText("content").insert(0, "typed ");
    await wait(50);
    expect((ctx.tab.setDirty as jest.Mock).mock.calls.filter(([dirty]) => dirty === true)).toEqual([]);
    tab.dispose();
  });

  it("4.2b closing the tab flushes the live file, then releases it, once each", async () => {
    const live = fakeLive();
    mockReadPageLiveFiles.mockResolvedValue(live.liveFiles);
    const { src } = source({ livePath: "projects/alpha/notes/n.qmd" });
    const { closers } = await openTab(src);
    expect(closers.length).toBeGreaterThan(0);
    for (const closer of closers) await closer();
    await wait(50);
    expect(live.flush).toHaveBeenCalledTimes(1);
    expect(live.release).toHaveBeenCalledTimes(1);
    expect(mockEvents.indexOf("flush")).toBeLessThan(mockEvents.indexOf("release"));
  });

  it("4.2b disposing the tab flushes the live file, then releases it, once each, and destroys the editor", async () => {
    const live = fakeLive();
    mockReadPageLiveFiles.mockResolvedValue(live.liveFiles);
    const { src } = source({ livePath: "projects/alpha/notes/n.qmd" });
    const { tab } = await openTab(src);
    tab.dispose();
    await until(() => live.release.mock.calls.length > 0);
    await wait(50);
    expect(live.flush).toHaveBeenCalledTimes(1);
    expect(live.release).toHaveBeenCalledTimes(1);
    expect(mockEvents.indexOf("flush")).toBeLessThan(mockEvents.indexOf("release"));
    expect(mockEvents).toContain("destroy");
  });

  it("4.2c without a livePath it reads the source and mounts with its text, without asking for live files", async () => {
    const { src, read } = source();
    const { options, tab } = await openTab(src);
    expect(read).toHaveBeenCalledTimes(1);
    expect(options["text"]).toBe("disk text");
    expect(options["live"]).toBeUndefined();
    expect(mockReadPageLiveFiles).not.toHaveBeenCalled();
    tab.dispose();
  });

  it("4.2c without live files it reads the source and mounts with its text", async () => {
    mockReadPageLiveFiles.mockResolvedValue(undefined);
    const { src, read, editItem } = source({ livePath: "projects/alpha/notes/n.qmd" });
    const { options, tab } = await openTab(src);
    expect(read).toHaveBeenCalledTimes(1);
    expect(options["text"]).toBe("disk text");
    expect(options["live"]).toBeUndefined();
    (options["save"] as (id: string, body: string) => void)("item-1", "new body");
    await until(() => editItem.mock.calls.length > 0);
    expect(editItem).toHaveBeenCalledWith("item-1", "new body");
    tab.dispose();
  });

  it("4.2c when reading the page's live files throws it reads the source and mounts with its text", async () => {
    mockReadPageLiveFiles.mockRejectedValue(new Error("no live files"));
    const { src, read } = source({ livePath: "projects/alpha/notes/n.qmd" });
    const { options, tab } = await openTab(src);
    expect(read).toHaveBeenCalledTimes(1);
    expect(options["text"]).toBe("disk text");
    expect(options["live"]).toBeUndefined();
    tab.dispose();
  });

  it("4.2c when opening the live file throws it reads the source and mounts with its text", async () => {
    const live = fakeLive();
    live.liveFiles.open.mockImplementation(() => { throw new Error("cannot open"); });
    mockReadPageLiveFiles.mockResolvedValue(live.liveFiles);
    const { src, read } = source({ livePath: "projects/alpha/notes/n.qmd" });
    const { options, tab } = await openTab(src);
    expect(read).toHaveBeenCalledTimes(1);
    expect(options["text"]).toBe("disk text");
    expect(options["live"]).toBeUndefined();
    tab.dispose();
  });

  it("4.2c when the replica's ready rejects it reads the source, mounts with its text and releases the replica", async () => {
    const live = fakeLive({ ready: Promise.reject(new Error("replica failed")) });
    mockReadPageLiveFiles.mockResolvedValue(live.liveFiles);
    const { src, read } = source({ livePath: "projects/alpha/notes/n.qmd" });
    const { options, tab } = await openTab(src);
    expect(read).toHaveBeenCalledTimes(1);
    expect(options["text"]).toBe("disk text");
    expect(options["live"]).toBeUndefined();
    expect(live.release).toHaveBeenCalledTimes(1);
    tab.dispose();
    await wait(50);
    expect(live.release).toHaveBeenCalledTimes(1);
  });
});

describe("note tab live paths", () => {
  it("4.2d the paper notes tab opens <paper folder>/notes.qmd as its live file", async () => {
    const live = fakeLive();
    mockReadPageLiveFiles.mockResolvedValue(live.liveFiles);
    mockMounts.length = 0;
    const { ctx } = context();
    const tab = mountPaperNoteTab(document.createElement("div"), { paperId: "paper-1" }, ctx);
    await until(() => mockMounts.length > 0);
    expect(live.liveFiles.open).toHaveBeenCalledWith("papers/2026/paper-1/notes.qmd");
    expect((mockMounts[0]!["live"] as { doc: Y.Doc }).doc).toBe(live.doc);
    tab.dispose();
  });

  it("4.2d a paper without a record has no live path and its notes tab mounts from the store", async () => {
    const live = fakeLive();
    mockReadPageLiveFiles.mockResolvedValue(live.liveFiles);
    mockMounts.length = 0;
    const { ctx } = context();
    const tab = mountPaperNoteTab(document.createElement("div"), { paperId: "unknown-paper" }, ctx);
    await until(() => mockMounts.length > 0);
    expect(mockMounts).toHaveLength(1);
    expect(live.liveFiles.open).not.toHaveBeenCalled();
    expect(mockMounts[0]!["live"]).toBeUndefined();
    tab.dispose();
  });
});
