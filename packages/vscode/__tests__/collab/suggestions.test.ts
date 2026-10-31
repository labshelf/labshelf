// Tests the suggestion store of the LabShelf source editor: add, subscribe and remove over comments.qmd in a local project and over the share's suggestions in a shared one.
import * as vscode from "vscode";

import { posixPathOps, type CommentsFileAccess, type SharedProjectSuggestions, type Suggestion } from "@labshelf/core";
import {
  currentSourceFileSuggestions, provideSourceFileSuggestions, SuggestionsController, type FileSuggestion, type SuggestionFiles, type SuggestionsDeps,
} from "../../src/collab/suggestions";

const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
const FOLDER = "/proj";
const fileUri = vscode.Uri.file("/proj/sections/intro.tex");
const TEXT = "The model works well here.\nSecond line of text.";

const flush = async (): Promise<void> => { await new Promise<void>((resolve) => { setTimeout(resolve, 5); }); };

function fakeEvent() {
  const listeners = new Set<() => void>();
  const event = (listener: () => void) => { listeners.add(listener); return { dispose: () => { listeners.delete(listener); } }; };
  return { event: event as unknown as vscode.Event<void>, fire: () => { for (const each of [...listeners]) { each(); } }, count: () => listeners.size };
}

/** A project folder whose comments.qmd and sources live in memory. */
function fakeFiles(sources: Record<string, string> = { "sections/intro.tex": TEXT }) {
  let comments: string | undefined;
  const watchers = new Set<() => void>();
  const stops = jest.fn();
  const files: SuggestionFiles = {
    comments: (): CommentsFileAccess => ({ read: async () => comments, write: async (text) => { comments = text; } }),
    textOf: async (_folder, file) => sources[file],
    watch: (_folder, onChange) => { watchers.add(onChange); return () => { stops(); watchers.delete(onChange); }; },
  };
  return { files, sources, stops, comments: () => comments, setComments: (text: string | undefined) => { comments = text; }, touch: () => { for (const each of [...watchers]) { each(); } } };
}

function fakeShared(initial: Suggestion[] = []) {
  let stored = [...initial];
  const listeners = new Set<() => void>();
  const shared = {
    suggestions: jest.fn(() => stored),
    locate: jest.fn((s: Suggestion) => ({ start: Number(s.anchor.toString().length), end: 0 })),
    anchor: jest.fn((_path: string, _kind: string, range: { start: number; end: number }) => ({ range }) as unknown as Suggestion["anchor"]),
    add: jest.fn((list: Suggestion[]) => { stored = [...stored, ...list]; for (const each of [...listeners]) { each(); } }),
    remove: jest.fn((ids: string[]) => { stored = stored.filter((each) => !ids.includes(each.id)); for (const each of [...listeners]) { each(); } }),
    onChange: jest.fn((listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }),
  };
  // A located suggestion sits where its anchor's range says.
  shared.locate.mockImplementation((s: Suggestion) => (s.anchor as unknown as { range: { start: number; end: number } }).range);
  return shared;
}

function build(options: { files?: ReturnType<typeof fakeFiles>; shared?: ReturnType<typeof fakeShared> } = {}) {
  const files = options.files ?? fakeFiles();
  const projects = fakeEvent();
  const shares = fakeEvent();
  let current = options.shared;
  let shareList: unknown[] = options.shared ? [{ folder: FOLDER, shareId: "s1", session: {} }] : [];
  const entries = [{ kind: "ready", folder: FOLDER, settings: { trashed: false } }];
  const deps: SuggestionsDeps = {
    projects: { list: () => entries as never, onDidChange: projects.event, paths: posixPathOps as never },
    shares: { list: () => shareList as never, onDidChange: shares.event },
    logger: logger as never,
    files: files.files,
    sharedSuggestions: () => current as unknown as SharedProjectSuggestions,
  };
  const controller = new SuggestionsController(deps);
  return {
    controller, files, projects, shares,
    share: (shared: ReturnType<typeof fakeShared>) => { current = shared; shareList = [{ folder: FOLDER, shareId: "s2", session: {} }]; shares.fire(); },
    unshare: () => { shareList = []; shares.fire(); },
  };
}

// A delete's text is already gone from the source, so its range is empty.
const suggestion = (over: Partial<FileSuggestion> = {}): FileSuggestion => ({ id: "s1", kind: "delete", start: 4, end: 4, text: "model ", author: "Ada", created: "2026-01-01T00:00:00.000Z", ...over });

function listen(controllerSuggestions: ReturnType<typeof build>["controller"], uri: vscode.Uri = fileUri) {
  const seen: FileSuggestion[][] = [];
  const port = controllerSuggestions.suggestionsFor(uri);
  const stop = port.subscribe((list) => seen.push(list));
  return { seen, port, stop, last: () => seen[seen.length - 1] };
}

beforeEach(() => {
  jest.clearAllMocks();
  provideSourceFileSuggestions(undefined);
});

describe("a local project", () => {
  it("4.2a lists nothing at first, for a file with no comments.qmd", async () => {
    const { controller } = build();
    const { last } = listen(controller);
    await flush();
    expect(last()).toEqual([]);
  });

  it("4.2a add stores the suggestion in comments.qmd and the subscriber gets it back with its range", async () => {
    const env = build();
    const { port, last } = listen(env.controller);
    await flush();
    await port.add([suggestion()]);
    await flush();
    expect(env.files.comments()).toContain("s1");
    expect(last()).toEqual([expect.objectContaining({ id: "s1", kind: "delete", start: 4, end: 4, author: "Ada" })]);
  });

  it("4.2a an insertion keeps its range and its group, and a delete keeps its group", async () => {
    const env = build();
    const { port, last } = listen(env.controller);
    // The inserted text is already in the source: "model" at 4..9.
    await port.add([suggestion({ id: "i1", kind: "insert", start: 4, end: 9, text: "model", group: "g1" }), suggestion({ id: "d1", kind: "delete", start: 10, end: 10, group: "g1" })]);
    await flush();
    expect(last()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "i1", kind: "insert", start: 4, end: 9, group: "g1" }),
      expect.objectContaining({ id: "d1", kind: "delete", start: 10, group: "g1" }),
    ]));
  });

  it("4.2a add of an id already stored replaces it instead of duplicating it", async () => {
    const env = build();
    const { port, last } = listen(env.controller);
    await port.add([suggestion()]);
    await port.add([suggestion({ start: 10, end: 10 })]);
    await flush();
    expect(last()?.map((each) => each.id)).toEqual(["s1"]);
  });

  it("4.2a remove takes the suggestions out of comments.qmd and the subscriber is told", async () => {
    const env = build();
    const { port, last } = listen(env.controller);
    await port.add([suggestion(), suggestion({ id: "s2", start: 14, end: 14 })]);
    await port.remove(["s1"]);
    await flush();
    expect(last()?.map((each) => each.id)).toEqual(["s2"]);
    await port.remove(["s2"]);
    await flush();
    expect(last()).toEqual([]);
  });

  it("4.2a a suggestion of another file is not listed for this one", async () => {
    const env = build({ files: fakeFiles({ "sections/intro.tex": TEXT, "sections/other.tex": TEXT }) });
    const other = listen(env.controller, vscode.Uri.file("/proj/sections/other.tex"));
    const mine = listen(env.controller);
    await other.port.add([suggestion()]);
    await flush();
    expect(other.last()?.map((each) => each.id)).toEqual(["s1"]);
    expect(mine.last()).toEqual([]);
  });

  it("4.2a a change of comments.qmd on disk is delivered again", async () => {
    const env = build();
    const { port, seen } = listen(env.controller);
    await port.add([suggestion()]);
    await flush();
    const count = seen.length;
    env.files.touch();
    await flush();
    expect(seen.length).toBeGreaterThan(count);
  });

  it("4.2a offsets are in the LF text: a CRLF file's suggestion comes back at the offsets it was added at", async () => {
    const env = build({ files: fakeFiles({ "sections/intro.tex": "line one\r\nline two\r\nline three" }) });
    const { port, last } = listen(env.controller);
    await port.add([suggestion({ start: 9, end: 9 })]);
    await flush();
    expect(last()).toEqual([expect.objectContaining({ id: "s1", start: 9 })]);
  });

  it("4.2a unsubscribing stops the deliveries", async () => {
    const env = build();
    const { port, seen, stop } = listen(env.controller);
    await flush();
    stop();
    const count = seen.length;
    await port.add([suggestion()]);
    await flush();
    expect(seen.length).toBe(count);
  });

  it("4.2a a file that is not inside an open project lists nothing and refuses to add", async () => {
    const env = build();
    const { port, last } = listen(env.controller, vscode.Uri.file("/elsewhere/a.tex"));
    await flush();
    expect(last()).toEqual([]);
    await expect(port.add([suggestion()])).rejects.toThrow("not inside an open LabShelf project");
  });

  it("4.2a adding nothing writes nothing", async () => {
    const env = build();
    await env.controller.suggestionsFor(fileUri).add([]);
    expect(env.files.comments()).toBeUndefined();
  });

  it("4.2a a comments.qmd that cannot be read lists nothing and logs the failure", async () => {
    const files = fakeFiles();
    files.files.comments = () => ({ read: async () => { throw new Error("disk gone"); }, write: async () => {} });
    const { controller } = build({ files });
    const { last } = listen(controller);
    await flush();
    expect(last()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith("collab.suggestions", expect.any(Error), expect.anything());
  });

  it("4.2a add to a file that does not exist is refused", async () => {
    const env = build({ files: fakeFiles({}) });
    await expect(env.controller.suggestionsFor(fileUri).add([suggestion()])).rejects.toThrow("does not exist");
  });
});

describe("a shared project", () => {
  it("4.2a subscribe lists the share's suggestions for the file at once", async () => {
    const shared = fakeShared([{ id: "a", file: "sections/intro.tex", kind: "delete", anchor: { range: { start: 2, end: 6 } } as never, author: "Bo", created: "2026-01-01T00:00:00.000Z" }]);
    const { controller } = build({ shared });
    const { last } = listen(controller);
    await flush();
    expect(last()).toEqual([expect.objectContaining({ id: "a", start: 2, end: 2, author: "Bo" })]);
  });

  it("4.2a add goes into the share anchored by the share, and the subscriber is told", async () => {
    const shared = fakeShared();
    const { controller } = build({ shared });
    const { port, last } = listen(controller);
    await flush();
    await port.add([suggestion({ kind: "insert", text: "x", start: 3, end: 3 })]);
    await flush();
    expect(shared.anchor).toHaveBeenCalledWith("sections/intro.tex", "insert", { start: 3, end: 3 });
    expect(shared.add).toHaveBeenCalledTimes(1);
    expect(last()).toEqual([expect.objectContaining({ id: "s1", kind: "insert", text: "x" })]);
  });

  it("4.2a add of an id the share holds removes the old one first", async () => {
    const shared = fakeShared();
    const { controller } = build({ shared });
    const { port, last } = listen(controller);
    await port.add([suggestion()]);
    await port.add([suggestion({ start: 10, end: 10 })]);
    await flush();
    expect(shared.remove).toHaveBeenCalledWith(["s1"]);
    expect(last()?.map((each) => each.id)).toEqual(["s1"]);
  });

  it("4.2a remove takes the suggestions out of the share", async () => {
    const shared = fakeShared();
    const { controller } = build({ shared });
    const { port, last } = listen(controller);
    await port.add([suggestion(), suggestion({ id: "s2", start: 14, end: 14 })]);
    await port.remove(["s1", "s2"]);
    await flush();
    expect(shared.remove).toHaveBeenLastCalledWith(["s1", "s2"]);
    expect(last()).toEqual([]);
  });

  it("4.2a a change another member makes reaches the subscriber", async () => {
    const shared = fakeShared();
    const { controller } = build({ shared });
    const { seen } = listen(controller);
    await flush();
    const count = seen.length;
    shared.add([{ id: "z", file: "sections/intro.tex", kind: "delete", anchor: { range: { start: 1, end: 3 } } as never, author: "Cy", created: "2026-01-01T00:00:00.000Z" }]);
    await flush();
    expect(seen.length).toBeGreaterThan(count);
    expect(seen[seen.length - 1]?.map((each) => each.id)).toEqual(["z"]);
  });

  it("4.2a a project that becomes shared switches its subscribers to the share, and back when it stops", async () => {
    const env = build();
    const { port, last } = listen(env.controller);
    await port.add([suggestion({ id: "local" })]);
    await flush();
    expect(last()?.map((each) => each.id)).toEqual(["local"]);
    const shared = fakeShared();
    env.share(shared);
    await flush();
    expect(last()).toEqual([]);
    await port.add([suggestion({ id: "live" })]);
    await flush();
    expect(shared.add).toHaveBeenCalledTimes(1);
    expect(last()?.map((each) => each.id)).toEqual(["live"]);
    env.unshare();
    await flush();
    expect(last()?.map((each) => each.id)).toEqual(["local"]);
  });
});

describe("the suggestion store registry", () => {
  it("4.2b has no store until one is provided, answers it, and none again once withdrawn", () => {
    expect(currentSourceFileSuggestions()).toBeUndefined();
    const { controller } = build();
    provideSourceFileSuggestions(controller);
    expect(currentSourceFileSuggestions()).toBe(controller);
    provideSourceFileSuggestions(undefined);
    expect(currentSourceFileSuggestions()).toBeUndefined();
  });

  it("4.2b disposing stops the watchers and the listening on projects and shares", () => {
    const env = build();
    env.controller.dispose();
    expect(env.files.stops).toHaveBeenCalledTimes(1);
    expect(env.projects.count()).toBe(0);
    expect(env.shares.count()).toBe(0);
  });
});
