/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Tests the browser deck tab kind: its spec and path routing, the edit view over ctx.fs with a serial saver (dirty while saving, flushed on close,
// a toast and a kept tab on a failed write), the present and poster actions, the presenter and audience views on one BroadcastChannel named
// after the deck, and the poster view's calibration in storage.local.
//
// Assumptions about what the spec leaves open: the deck editor, the presenter and the poster preview are reached through the lazy
// @labshelf/core/dom exports (or @labshelf/core/deckEditor), both mocked here; the project folder comes from ctx.project().session.current()
// like the source tab; the audience tab URL is checked on its hash suffix only; the save failure toast names the deck-relative or project path.
import { TAB_KIND_SPECS, type TabKindName, type TabParams } from "@labshelf/core";
import type { TabContext } from "../../../src/libraryUi/editorArea/tabKinds";

interface FakeController { element: HTMLElement; setSaved: jest.Mock; destroy: jest.Mock; setDocument: jest.Mock; selectSlide: jest.Mock; currentSlide: jest.Mock; undo: jest.Mock; redo: jest.Mock }
const mockFakeController = (): FakeController => ({
  element: document.createElement("div"), setSaved: jest.fn(), destroy: jest.fn(), setDocument: jest.fn(), selectSlide: jest.fn(), currentSlide: jest.fn(() => 0), undo: jest.fn(), redo: jest.fn(),
});

const mockDeck = {
  openDeckEditor: jest.fn((_host: HTMLElement, _options: Record<string, unknown>) => mockFakeController()),
  openPresenter: jest.fn((_host: HTMLElement, _options: Record<string, unknown>) => ({ state: jest.fn(), dispatch: jest.fn(), destroy: jest.fn() })),
  openPosterPreview: jest.fn(async (_host: HTMLElement, _options: Record<string, unknown>) => ({
    zoom: () => 1, setZoom: jest.fn(), setUnit: jest.fn(), smallText: () => [], calibrated: () => false, destroy: jest.fn(),
  })),
  showToast: jest.fn(() => () => undefined),
};

jest.mock("@labshelf/core/dom", () => {
  const channel = jest.requireActual("../../../../core/src/decks/presenterChannel");
  return {
    ...jest.requireActual("@labshelf/core/dom"),
    createBroadcastPresenterChannel: channel.createBroadcastPresenterChannel,
    loadDeckEditor: async () => ({ openDeckEditor: mockDeck.openDeckEditor, openDeckWorkspace: mockDeck.openDeckEditor }),
    openDeckEditor: mockDeck.openDeckEditor,
    openDeckWorkspace: mockDeck.openDeckEditor,
    openPresenter: mockDeck.openPresenter,
    openPosterPreview: mockDeck.openPosterPreview,
    showToast: mockDeck.showToast,
  };
});
jest.mock("@labshelf/core/deckEditor", () => {
  const channel = jest.requireActual("../../../../core/src/decks/presenterChannel");
  return {
    createBroadcastPresenterChannel: channel.createBroadcastPresenterChannel,
    loadDeckEditor: async () => ({ openDeckEditor: mockDeck.openDeckEditor, openDeckWorkspace: mockDeck.openDeckEditor }),
    openDeckEditor: mockDeck.openDeckEditor,
    openDeckWorkspace: mockDeck.openDeckEditor,
    openPresenter: mockDeck.openPresenter,
    openPosterPreview: mockDeck.openPosterPreview,
  };
});
jest.mock("@labshelf/core/math", () => ({ renderMathSvg: jest.fn() }));

const mockStorage: Record<string, unknown> = {};
const mockBx = {
  storage: {
    local: {
      get: jest.fn(async (key: string) => ({ [key]: mockStorage[key] })),
      set: jest.fn(async (items: Record<string, unknown>) => { Object.assign(mockStorage, items); }),
    },
    sync: { get: jest.fn(async () => ({})), set: jest.fn(async () => undefined) },
  },
  tabs: { create: jest.fn(async (_props: { url?: string }) => ({ id: 1 })) },
  runtime: { getURL: (path: string) => `chrome-extension://labshelf/${path.replace(/^\//, "")}` },
};
jest.mock("webextension-polyfill", () => mockBx);

// jsdom has no BroadcastChannel; record each channel's name.
const channelNames: string[] = [];
class FakeBroadcastChannel extends EventTarget {
  constructor(readonly name: string) { super(); channelNames.push(name); }
  postMessage(): void { /* no peers in a test */ }
  close(): void { /* nothing to release */ }
}
Object.defineProperty(globalThis, "BroadcastChannel", { value: FakeBroadcastChannel, configurable: true, writable: true });

const deckTab = () => jest.requireActual<typeof import("../../../src/libraryUi/editorArea/deckTab")>("../../../src/libraryUi/editorArea/deckTab");

const FOLDER = "projects/p1";
const PATH = "talks/intro/deck.html";
const DECK_FILE = `${FOLDER}/${PATH}`;
const THEME_FILE = `${FOLDER}/talks/intro/theme.css`;
const HTML = '<!doctype html>\n<html><body><section class="slide"><h1>Intro</h1></section></body></html>\n';
const THEME = ":root { --deck-accent: #336699; }\n";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await wait(5);
}

interface FakeFs {
  files: Map<string, string>;
  writes: string[];
  maxInFlight: number;
  /** Per-path write delay in ms; the first write is slow so an unserialised second write would finish first. */
  delay: (path: string, n: number) => number;
  failPaths: Set<string>;
  gate: { hold: boolean; release: Array<() => void> };
  api: Record<string, unknown>;
}

function fakeFs(initial: Record<string, string>): FakeFs {
  const state: FakeFs = { files: new Map(Object.entries(initial)), writes: [], maxInFlight: 0, delay: (_p, n) => (n === 0 ? 60 : 5), failPaths: new Set(), gate: { hold: false, release: [] }, api: {} };
  let inFlight = 0;
  const missing = (path: string) => Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
  state.api = {
    readText: async (path: string) => { const text = state.files.get(path); if (text === undefined) throw missing(path); return text; },
    readFile: async (path: string) => { const text = state.files.get(path); if (text === undefined) throw missing(path); return new TextEncoder().encode(text); },
    exists: async (path: string) => state.files.has(path),
    stat: async (path: string) => (state.files.has(path) ? { isFile: true, isDirectory: false, mtimeMs: 0, size: state.files.get(path)!.length } : undefined),
    listDir: async () => [],
    ensureDir: async () => undefined,
    mkdir: async () => undefined,
    writeText: async (path: string, text: string) => {
      const n = state.writes.length;
      state.writes.push(path);
      inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, inFlight);
      try {
        if (state.gate.hold) await new Promise<void>((resolve) => state.gate.release.push(resolve));
        await wait(state.delay(path, n));
        if (state.failPaths.has(path)) throw new Error("disk full");
        state.files.set(path, text);
      } finally {
        inFlight -= 1;
      }
    },
    writeFile: async (path: string, bytes: Uint8Array) => { state.files.set(path, new TextDecoder().decode(bytes)); },
  };
  return state;
}

interface Opened {
  host: HTMLElement;
  body: ReturnType<ReturnType<typeof deckTab>["mountTab"]>;
  fs: FakeFs;
  tab: { setDirty: jest.Mock; onBeforeClose: jest.Mock };
  workspace: { openTab: jest.Mock };
  beforeClose(): Promise<boolean>;
}

function mount(params: TabParams, files: Record<string, string> = { [DECK_FILE]: HTML, [THEME_FILE]: THEME }): Opened {
  const fs = fakeFs(files);
  const tab = { setDirty: jest.fn(), onBeforeClose: jest.fn() };
  const workspace = { openTab: jest.fn((_kind: TabKindName, _params?: TabParams, _group?: number) => undefined) };
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  const entry = { kind: "ready", folder: FOLDER, settings: { id: "p1", name: "P1", format: "qmd" } };
  const session = { current: () => entry };
  const ctx = { fs: fs.api, tab, workspace, logger, project: () => ({ session }) } as unknown as TabContext;
  document.body.replaceChildren();
  const host = document.createElement("div");
  document.body.append(host);
  const body = deckTab().mountTab(host, params, ctx);
  const beforeClose = async (): Promise<boolean> => {
    const handler = tab.onBeforeClose.mock.calls.at(-1)?.[0] as (() => Promise<boolean> | boolean) | undefined;
    expect(handler).toBeDefined();
    return handler!();
  };
  return { host, body, fs, tab, workspace, beforeClose };
}

const editorOptions = () => mockDeck.openDeckEditor.mock.calls.at(-1)![1] as { html: string; theme: string; history?: string; resolveAsset: unknown; loadMath?: unknown; onChange(change: { html: string; theme: string; label: string }): void };
const mountEditor = async (params: TabParams = { projectId: "p1", path: PATH }, files?: Record<string, string>): Promise<Opened> => {
  const opened = mount(params, files);
  await until(() => mockDeck.openDeckEditor.mock.calls.length > 0);
  return opened;
};

beforeEach(() => {
  jest.clearAllMocks();
  channelNames.length = 0;
  for (const key of Object.keys(mockStorage)) delete mockStorage[key];
});

describe("deck tab kind", () => {
  it("9.1a TAB_KIND_SPECS has the deck kind with params projectId, path and view", () => {
    const spec = (TAB_KIND_SPECS as Record<string, { kind: string; params: readonly string[]; id(p: TabParams): string }>)["deck"];
    expect(spec).toBeDefined();
    expect(spec!.kind).toBe("deck");
    expect([...spec!.params]).toEqual(["projectId", "path", "view"]);
    expect(spec!.id({ projectId: "p1", path: PATH, view: "audience" })).toBe(`deck:p1:${encodeURIComponent(PATH)}:audience`);
  });

  it("9.1a isDeckPath accepts talks/<name>/deck.html and posters/<name>/deck.html", () => {
    const { isDeckPath } = deckTab();
    expect(isDeckPath("talks/intro/deck.html")).toBe(true);
    expect(isDeckPath("posters/icml-2026/deck.html")).toBe(true);
  });

  it("9.1a isDeckPath rejects every other path", () => {
    const { isDeckPath } = deckTab();
    for (const path of ["", "deck.html", "talks/deck.html", "talks/a/b/deck.html", "slides/a/deck.html", "talks/a/deck.htm", "talks/a/theme.css", "x/talks/a/deck.html", "posters/a/deck.html.bak", "talks//deck.html"]) {
      expect([path, isDeckPath(path)]).toEqual([path, false]);
    }
  });

  it("9.1a the browser registry has a deck kind whose body module mounts a tab", async () => {
    const { TAB_KINDS } = await import("../../../src/libraryUi/editorArea/tabKinds");
    const kind = (TAB_KINDS as Record<string, { load(): Promise<{ mountTab: unknown }> }>)["deck"];
    expect(kind).toBeDefined();
    expect(typeof (await kind!.load()).mountTab).toBe("function");
  });

  it("9.1a a talks/*/deck.html or posters/*/deck.html source path opens the deck tab", async () => {
    const { TAB_KINDS } = await import("../../../src/libraryUi/editorArea/tabKinds");
    const source = await TAB_KINDS.source.load();
    for (const path of [PATH, "posters/main/deck.html"]) {
      mockDeck.openDeckEditor.mockClear();
      const files = { [`${FOLDER}/${path}`]: HTML };
      const fs = fakeFs(files);
      const ctx = {
        fs: fs.api, tab: { setDirty: jest.fn(), onBeforeClose: jest.fn() }, workspace: { openTab: jest.fn(), closeTabs: jest.fn(async () => true) },
        logger: { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) },
        project: () => ({ session: { current: () => ({ kind: "ready", folder: FOLDER, settings: { id: "p1" } }) } }),
      } as unknown as TabContext;
      const host = document.createElement("div");
      const body = source.mountTab(host, { projectId: "p1", path }, ctx);
      await until(() => mockDeck.openDeckEditor.mock.calls.length > 0);
      expect(mockDeck.openDeckEditor).toHaveBeenCalledTimes(1);
      expect(editorOptions().html).toBe(HTML);
      body.dispose();
    }
  });
});

describe("deck tab edit view", () => {
  it("9.1b mounts the deck editor with the deck and theme texts read through ctx.fs", async () => {
    const t = await mountEditor();
    const options = editorOptions();
    expect(options.html).toBe(HTML);
    expect(options.theme).toBe(THEME);
    expect(options.history ?? "internal").toBe("internal");
    expect(typeof options.resolveAsset).toBe("function");
    expect(typeof options.loadMath).toBe("function");
    t.body.dispose();
  });

  it("9.1b a missing or unknown view mounts the editor", async () => {
    const t = await mountEditor({ projectId: "p1", path: PATH, view: "slideshow" });
    expect(mockDeck.openDeckEditor).toHaveBeenCalledTimes(1);
    expect(mockDeck.openPresenter).not.toHaveBeenCalled();
    expect(mockDeck.openPosterPreview).not.toHaveBeenCalled();
    t.body.dispose();
  });

  it("9.1b a missing theme.css mounts the editor with an empty theme", async () => {
    const t = await mountEditor(undefined, { [DECK_FILE]: HTML });
    expect(editorOptions().theme).toBe("");
    t.body.dispose();
  });

  it("9.1b writes only deck.html when only the deck text changed", async () => {
    const t = await mountEditor();
    editorOptions().onChange({ html: HTML + "<!-- edit -->\n", theme: THEME, label: "Edit text" });
    expect(await t.beforeClose()).toBe(true);
    expect(t.fs.files.get(DECK_FILE)).toBe(HTML + "<!-- edit -->\n");
    expect(t.fs.writes).not.toContain(THEME_FILE);
    expect(t.fs.writes).toContain(DECK_FILE);
    t.body.dispose();
  });

  it("9.1b writes only theme.css when only the theme changed", async () => {
    const t = await mountEditor();
    const theme = ":root { --deck-accent: #993366; }\n";
    editorOptions().onChange({ html: HTML, theme, label: "Theme" });
    expect(await t.beforeClose()).toBe(true);
    expect(t.fs.files.get(THEME_FILE)).toBe(theme);
    expect(t.fs.writes).toEqual(t.fs.writes.filter((path) => path === THEME_FILE));
    expect(t.fs.writes.length).toBeGreaterThan(0);
    t.body.dispose();
  });

  it("9.1b saves successive changes one write at a time and ends with the last text", async () => {
    const t = await mountEditor();
    editorOptions().onChange({ html: HTML + "<!-- 1 -->\n", theme: THEME, label: "One" });
    await until(() => t.fs.writes.length > 0, 500);
    editorOptions().onChange({ html: HTML + "<!-- 2 -->\n", theme: THEME + "/* 2 */\n", label: "Two" });
    expect(await t.beforeClose()).toBe(true);
    expect(t.fs.maxInFlight).toBe(1);
    expect(t.fs.files.get(DECK_FILE)).toBe(HTML + "<!-- 2 -->\n");
    expect(t.fs.files.get(THEME_FILE)).toBe(THEME + "/* 2 */\n");
    t.body.dispose();
  });

  it("9.1b marks the tab dirty while a write is pending and clean once it is written", async () => {
    const t = await mountEditor();
    t.fs.gate.hold = true;
    editorOptions().onChange({ html: HTML + "<!-- edit -->\n", theme: THEME, label: "Edit" });
    await until(() => t.fs.gate.release.length > 0);
    expect(t.fs.gate.release.length).toBeGreaterThan(0);
    expect(t.tab.setDirty).toHaveBeenLastCalledWith(true);
    t.fs.gate.hold = false;
    for (const release of t.fs.gate.release.splice(0)) release();
    await until(() => t.tab.setDirty.mock.calls.at(-1)?.[0] === false);
    expect(t.tab.setDirty).toHaveBeenLastCalledWith(false);
    expect(t.fs.files.get(DECK_FILE)).toBe(HTML + "<!-- edit -->\n");
    t.body.dispose();
  });

  it("9.1b flushes a pending change before the tab closes", async () => {
    const t = await mountEditor();
    t.fs.delay = () => 80;
    editorOptions().onChange({ html: HTML + "<!-- late -->\n", theme: THEME, label: "Late" });
    const closing = t.beforeClose();
    expect(t.fs.files.get(DECK_FILE)).toBe(HTML);
    expect(await closing).toBe(true);
    expect(t.fs.files.get(DECK_FILE)).toBe(HTML + "<!-- late -->\n");
    t.body.dispose();
  });

  it("9.1b a failed write shows 'Could not save <file>.' and keeps the tab open", async () => {
    const t = await mountEditor();
    t.fs.failPaths.add(DECK_FILE);
    editorOptions().onChange({ html: HTML + "<!-- edit -->\n", theme: THEME, label: "Edit" });
    await until(() => mockDeck.showToast.mock.calls.length > 0);
    const [message, kind] = mockDeck.showToast.mock.calls[0] as unknown as [string, string];
    expect(message).toMatch(/^Could not save (?:(?:projects\/p1\/)?talks\/intro\/)?deck\.html\.$/);
    expect(kind).toBe("error");
    expect(await t.beforeClose()).toBe(false);
    t.body.dispose();
  });

  it("9.1b returns its body synchronously and a dispose before the mount finishes leaves no editor", async () => {
    const t = mount({ projectId: "p1", path: PATH });
    expect(typeof t.body.dispose).toBe("function");
    t.body.dispose();
    await wait(150);
    for (const result of mockDeck.openDeckEditor.mock.results) expect((result.value as FakeController).destroy).toHaveBeenCalled();
  });

  it("9.1b dispose destroys the mounted editor", async () => {
    const t = await mountEditor();
    const controller = mockDeck.openDeckEditor.mock.results[0]!.value as FakeController;
    t.body.dispose();
    expect(controller.destroy).toHaveBeenCalled();
  });
});

describe("deck tab presenter, audience and poster views", () => {
  const actions = (t: Opened) => (t.body.actions ?? []) as ReadonlyArray<{ id: string; run(): void }>;

  it("9.1d the present action opens the presenter view and a browser tab of the audience view", async () => {
    const t = await mountEditor();
    await until(() => actions(t).some((a) => a.id === "present"));
    actions(t).find((a) => a.id === "present")!.run();
    await until(() => mockBx.tabs.create.mock.calls.length > 0 && t.workspace.openTab.mock.calls.length > 0);
    const [kind, params] = t.workspace.openTab.mock.calls[0]!;
    expect(kind).toBe("deck");
    expect(params).toEqual({ projectId: "p1", path: PATH, view: "presenter" });
    const id = (TAB_KIND_SPECS as Record<string, { id(p: TabParams): string }>)["deck"]!.id({ projectId: "p1", path: PATH, view: "audience" });
    const url = String(mockBx.tabs.create.mock.calls[0]![0].url);
    expect(url.endsWith(`#/tabs/${encodeURIComponent(id)};active=${encodeURIComponent(id)}`)).toBe(true);
    t.body.dispose();
  });

  it("9.1d the posterPreview action opens the poster view of the same deck", async () => {
    const t = await mountEditor();
    await until(() => actions(t).some((a) => a.id === "posterPreview"));
    actions(t).find((a) => a.id === "posterPreview")!.run();
    await until(() => t.workspace.openTab.mock.calls.length > 0);
    const [kind, params] = t.workspace.openTab.mock.calls[0]!;
    expect(kind).toBe("deck");
    expect(params).toEqual({ projectId: "p1", path: PATH, view: "poster" });
    t.body.dispose();
  });

  it("9.1d the presenter and audience views mount the presenter on a BroadcastChannel named after the deck", async () => {
    const roles: string[] = [];
    for (const view of ["presenter", "audience"]) {
      const t = mount({ projectId: "p1", path: PATH, view });
      await until(() => mockDeck.openPresenter.mock.calls.length > roles.length);
      const options = mockDeck.openPresenter.mock.calls.at(-1)![1] as { role: string; html: string; theme: string; channel: unknown; resolveAsset: unknown };
      roles.push(options.role);
      expect(options.html).toBe(HTML);
      expect(options.theme).toBe(THEME);
      expect(options.channel).toBeDefined();
      expect(typeof options.resolveAsset).toBe("function");
      t.body.dispose();
    }
    expect(roles).toEqual(["presenter", "audience"]);
    expect(mockDeck.openDeckEditor).not.toHaveBeenCalled();
    expect(channelNames).toEqual([`labshelf-deck:p1:${PATH}`, `labshelf-deck:p1:${PATH}`]);
  });

  it("9.1d the poster view keeps its calibration in storage.local under labshelf.decks.calibration", async () => {
    const t = mount({ projectId: "p1", path: "posters/main/deck.html", view: "poster" }, { [`${FOLDER}/posters/main/deck.html`]: HTML });
    await until(() => mockDeck.openPosterPreview.mock.calls.length > 0);
    const options = mockDeck.openPosterPreview.mock.calls[0]![1] as { html: string; store: { load(): Promise<unknown>; save(c: { pxPerMm: number; measuredAt: string }): Promise<void> } };
    expect(options.html).toBe(HTML);
    const calibration = { pxPerMm: 4.2, measuredAt: "2026-11-02T10:00:00.000Z" };
    await options.store.save(calibration);
    expect(mockStorage["labshelf.decks.calibration"]).toEqual(calibration);
    expect(mockBx.storage.sync.set).not.toHaveBeenCalled();
    expect(await options.store.load()).toEqual(calibration);
    t.body.dispose();
  });

  it("11.3 the poster view resolves full-resolution blob URLs of the original bytes and revokes them on dispose", async () => {
    const blobs: Blob[] = [];
    const revoked: string[] = [];
    Object.assign(URL, { createObjectURL: (blob: Blob) => { blobs.push(blob); return `blob:full/${blobs.length}`; }, revokeObjectURL: (url: string) => { revoked.push(url); } });
    const t = mount({ projectId: "p1", path: "posters/main/deck.html", view: "poster" }, { [`${FOLDER}/posters/main/deck.html`]: HTML, [`${FOLDER}/posters/main/assets/pic.png`]: "PNGBYTES" });
    await until(() => mockDeck.openPosterPreview.mock.calls.length > 0);
    const options = mockDeck.openPosterPreview.mock.calls[0]![1] as { resolveAsset(path: string): Promise<string> };
    const url = await options.resolveAsset("assets/pic.png");
    expect(url).toBe("blob:full/1");
    expect(blobs[0]!.type).toBe("image/png");
    expect(blobs[0]!.size).toBe("PNGBYTES".length);
    t.body.dispose();
    expect(revoked).toContain(url);
  });
});
