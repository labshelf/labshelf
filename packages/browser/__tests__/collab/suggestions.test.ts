// The page's suggestion stores for the editor's review mode: over comments.qmd in a local project, over the share's suggestions in a shared one, and the routing between them.
import {
  deriveAnchor, deriveSuggestions, parseCommentsQmd, type CommentAnchor, type IFileSystem, type LibraryFileSystem, type ProjectEntry, type SharedProjectSuggestions,
  type Suggestion, type SuggestionKind, type TextRange,
} from "@labshelf/core";
import type { FileSuggestion } from "@labshelf/core/dom";
import { createFileSuggestions, createRoutedSuggestions } from "../../src/collab";

const COMMENTS = "/lib/p/.labshelf/comments.qmd";
const SOURCE = "Intro\nWe use a strong baseline here.\nThe end.\n";
const AT = SOURCE.indexOf("strong");

const insert = (id: string, extra: Partial<FileSuggestion> = {}): FileSuggestion =>
  ({ id, kind: "insert", start: AT, end: AT + 6, author: "Ana", created: "2026-01-01T00:00:00.000Z", ...extra });
const del = (id: string, extra: Partial<FileSuggestion> = {}): FileSuggestion =>
  ({ id, kind: "delete", start: SOURCE.indexOf("here"), end: SOURCE.indexOf("here"), text: "very ", author: "Ana", created: "2026-01-02T00:00:00.000Z", ...extra });

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// Verifies the store over comments.qmd: add, replace by id, remove and subscribe round-trip in saved-text offsets; other files' and detached suggestions are left out.
describe("file suggestions", () => {
  function writableFs(files: Record<string, string>): LibraryFileSystem {
    const dirs = new Set<string>();
    const fake: IFileSystem = {
      exists: async (target) => target in files || dirs.has(target),
      readText: async (target) => files[target]!,
      writeText: async (target, text) => { files[target] = text; },
      ensureDir: async (dir) => { dirs.add(dir); },
    };
    return fake as LibraryFileSystem;
  }

  const entry = { kind: "ready", folder: "/lib/p", settings: { id: "p", title: "P", format: "latex" }, main: "main.tex" } as unknown as ProjectEntry;

  function setup(extra: Record<string, string> = {}) {
    const files: Record<string, string> = { "/lib/p/main.tex": SOURCE, "/lib/p/other.tex": SOURCE, ...extra };
    const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as never;
    const store = createFileSuggestions({ fs: writableFs(files), session: { current: () => entry }, logger });
    const stored = (): Suggestion[] => deriveSuggestions(parseCommentsQmd(files[COMMENTS]!)!);
    return { files, store, stored, editor: store.suggestionsFor("p", "main.tex") };
  }

  it("3.1a stores an added insert and delete in comments.qmd with anchors from the saved text", async () => {
    const { editor, stored } = setup();
    await editor.add([insert("i1"), del("d1", { group: "g" })]);
    const [first, second] = stored();
    expect(first).toMatchObject({ id: "i1", file: "main.tex", kind: "insert", author: "Ana", anchor: { quote: "strong" } });
    expect(second).toMatchObject({ id: "d1", file: "main.tex", kind: "delete", text: "very ", group: "g", anchor: { quote: "" } });
    expect(second!.anchor.prefix.endsWith("baseline ")).toBe(true);
  });

  it("3.1a tells a subscriber the file's suggestions now and after each add and remove", async () => {
    const { editor } = setup();
    const seen: (readonly FileSuggestion[])[] = [];
    const stop = editor.subscribe((list) => seen.push(list));
    await flush();
    await editor.add([insert("i1")]);
    await flush();
    await editor.remove(["i1"]);
    await flush();
    stop();
    await editor.add([insert("i2")]);
    await flush();
    expect(seen.map((list) => list.map((each) => each.id))).toEqual([[], ["i1"], []]);
    expect(seen[1]![0]).toEqual(insert("i1"));
  });

  it("3.1a gives a delete an empty range at its position", async () => {
    const { editor } = setup();
    const seen: (readonly FileSuggestion[])[] = [];
    editor.subscribe((list) => seen.push(list));
    await editor.add([del("d1")]);
    await flush();
    expect(seen.at(-1)).toEqual([del("d1")]);
  });

  it("3.1a replaces a suggestion whose id is already stored", async () => {
    const { editor, stored } = setup();
    await editor.add([insert("i1")]);
    await editor.add([insert("i1", { end: AT + 10, author: "Bo" })]);
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ id: "i1", author: "Bo", anchor: { quote: "strong bas" } });
  });

  it("3.1a removes exactly the listed ids and leaves comment threads alone", async () => {
    const { editor, stored, files } = setup();
    await editor.add([insert("i1"), del("d1"), insert("i2", { start: 0, end: 5 })]);
    await editor.remove(["i1", "d1", "unknown"]);
    expect(stored().map((each) => each.id)).toEqual(["i2"]);
    expect(files[COMMENTS]).toContain("i2");
  });

  it("3.1a leaves out the suggestions of other files and the detached ones", async () => {
    const { editor, files, store } = setup();
    await store.suggestionsFor("p", "other.tex").add([insert("o1")]);
    await editor.add([insert("i1"), insert("i2", { start: 0, end: 5 })]);
    files["/lib/p/main.tex"] = "Completely different.\n";
    const seen: (readonly FileSuggestion[])[] = [];
    editor.subscribe((list) => seen.push(list));
    await flush();
    expect(seen).toEqual([[]]);
    files["/lib/p/main.tex"] = SOURCE;
    const again: (readonly FileSuggestion[])[] = [];
    editor.subscribe((list) => again.push(list));
    await flush();
    expect(again[0]!.map((each) => each.id).sort()).toEqual(["i1", "i2"]);
  });

  it("3.1a refuses a project that is not the open one and an invalid comments.qmd", async () => {
    const { store, files, editor } = setup({ [COMMENTS]: "<<<<<<< ours\n" });
    await expect(store.suggestionsFor("other", "main.tex").add([insert("i1")])).rejects.toThrow(/not the open project/);
    await expect(editor.add([insert("i1")])).rejects.toThrow(/left as it is/);
    expect(files[COMMENTS]).toBe("<<<<<<< ours\n");
  });
});

// Verifies routed suggestions use the share's store while the project is shared and comments.qmd otherwise, for add, subscribe and remove (accept and reject).
describe("routed suggestions", () => {
  function fakeFiles(label: string) {
    const calls: string[] = [];
    const listeners = new Set<(list: readonly FileSuggestion[]) => void>();
    const editor = {
      subscribe: (listener: (list: readonly FileSuggestion[]) => void) => { listeners.add(listener); listener([{ ...insert(label) }]); return () => void listeners.delete(listener); },
      add: jest.fn(async (list: readonly FileSuggestion[]) => { calls.push(`${label}:add:${list.map((each) => each.id)}`); }),
      remove: jest.fn(async (ids: readonly string[]) => { calls.push(`${label}:remove:${ids}`); }),
    };
    return { files: { suggestionsFor: jest.fn(() => editor) }, editor, calls, listeners };
  }

  /** A share's suggestions over arrays: an insert is located by its quote, a delete by its prefix and suffix. */
  function fakeShared(text: string) {
    const list: Suggestion[] = [];
    const listeners = new Set<() => void>();
    const notify = (): void => listeners.forEach((l) => l());
    const shared: SharedProjectSuggestions = {
      suggestions: () => [...list],
      locate(suggestion): TextRange | "detached" {
        if (suggestion.kind === "delete") { const at = text.indexOf(suggestion.anchor.prefix + suggestion.anchor.suffix); return at === -1 ? "detached" : { start: at + suggestion.anchor.prefix.length, end: at + suggestion.anchor.prefix.length }; }
        const at = text.indexOf(suggestion.anchor.quote);
        return at === -1 ? "detached" : { start: at, end: at + suggestion.anchor.quote.length };
      },
      anchor(_file: string, kind: SuggestionKind, range: TextRange): CommentAnchor {
        return deriveAnchor(text, range.start, kind === "insert" ? range.end : range.start);
      },
      add(added) {
        const taken = added.find((each) => list.some((have) => have.id === each.id));
        if (taken) { throw new Error(`taken ${taken.id}`); }
        list.push(...added);
        notify();
      },
      remove(ids) {
        for (const id of ids) { const at = list.findIndex((each) => each.id === id); if (at !== -1) { list.splice(at, 1); } }
        notify();
      },
      onChange(listener) { listeners.add(listener); return () => void listeners.delete(listener); },
    };
    return { shared, list };
  }

  function setup() {
    const file = fakeFiles("file");
    const live = fakeShared(SOURCE);
    let active: { suggestions: SharedProjectSuggestions } | undefined;
    const changes = new Set<() => void>();
    const shares = { live: (id: string) => (id === "p" ? active : undefined), onChange: (l: () => void) => { changes.add(l); return () => void changes.delete(l); } };
    const routed = createRoutedSuggestions({ files: file.files as never, shares: shares as never });
    const setActive = (on: boolean): void => { active = on ? { suggestions: live.shared } : undefined; changes.forEach((l) => l()); };
    return { file, live, routed, setActive };
  }

  it("A3 sends add and remove to the file store while the project is not shared", async () => {
    const { file, routed } = setup();
    const editor = routed.suggestionsFor("p", "main.tex");
    await editor.add([insert("i1")]);
    await editor.remove(["i1"]);
    expect(file.files.suggestionsFor).toHaveBeenCalledWith("p", "main.tex");
    expect(file.calls).toEqual(["file:add:i1", "file:remove:i1"]);
  });

  it("3.1a round-trips add, subscribe and remove over the share's suggestions", async () => {
    const { live, routed, setActive, file } = setup();
    setActive(true);
    const editor = routed.suggestionsFor("p", "main.tex");
    const seen: (readonly FileSuggestion[])[] = [];
    const stop = editor.subscribe((list) => seen.push(list));
    await editor.add([insert("i1"), del("d1", { group: "g" })]);
    expect(live.list).toHaveLength(2);
    expect(live.list[0]).toMatchObject({ id: "i1", file: "main.tex", kind: "insert", author: "Ana", anchor: { quote: "strong" } });
    expect(live.list[1]).toMatchObject({ id: "d1", kind: "delete", text: "very ", group: "g", anchor: { quote: "" } });
    expect(seen.at(-1)).toEqual([insert("i1"), del("d1", { group: "g" })]);
    await editor.remove(["i1"]);
    expect(seen.at(-1)).toEqual([del("d1", { group: "g" })]);
    stop();
    expect(file.calls).toEqual([]);
  });

  it("3.1a replaces a shared suggestion whose id is already there", async () => {
    const { live, routed, setActive } = setup();
    setActive(true);
    const editor = routed.suggestionsFor("p", "main.tex");
    await editor.add([insert("i1")]);
    await editor.add([insert("i1", { end: AT + 10, author: "Bo" })]);
    expect(live.list).toHaveLength(1);
    expect(live.list[0]).toMatchObject({ author: "Bo", anchor: { quote: "strong bas" } });
  });

  it("3.1a leaves out the shared suggestions of other files and the detached ones", async () => {
    const { live, routed, setActive } = setup();
    setActive(true);
    await routed.suggestionsFor("p", "main.tex").add([insert("i1")]);
    await routed.suggestionsFor("p", "other.tex").add([insert("o1")]);
    live.list.push({ ...live.list[0]!, id: "gone", anchor: { quote: "not in the text", prefix: "", suffix: "" } });
    const seen: (readonly FileSuggestion[])[] = [];
    routed.suggestionsFor("p", "main.tex").subscribe((list) => seen.push(list));
    expect(seen[0]!.map((each) => each.id)).toEqual(["i1"]);
  });

  it("A3 sends remove to the share's store once the share is live and back to the file store after", async () => {
    const { file, live, routed, setActive } = setup();
    const editor = routed.suggestionsFor("p", "main.tex");
    setActive(true);
    await editor.add([insert("i1")]);
    await editor.remove(["i1"]);
    expect(live.list).toEqual([]);
    setActive(false);
    await editor.remove(["i2"]);
    expect(file.calls).toEqual(["file:remove:i2"]);
  });

  it("re-subscribes when the share opens and closes, and stops with the subscription", () => {
    const { file, routed, setActive } = setup();
    const seen: string[][] = [];
    const stop = routed.suggestionsFor("p", "main.tex").subscribe((list) => seen.push(list.map((each) => each.id)));
    setActive(true);
    setActive(false);
    expect(seen).toEqual([["file"], [], ["file"]]);
    expect(file.listeners.size).toBe(1);
    stop();
    expect(file.listeners.size).toBe(0);
    setActive(true);
    expect(seen).toHaveLength(3);
  });
});
