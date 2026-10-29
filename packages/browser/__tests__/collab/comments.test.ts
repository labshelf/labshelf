/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// The page's comment store, routing between live and stored threads, and the source editor's comment marks and Add comment button.
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { parseCommentsQmd, type IFileSystem, type ILogger, type LibraryFileSystem, type ProjectEntry, type TextRange } from "@labshelf/core";
import { addCommentSupport, createCommentThreads, createRoutedCommentThreads, type CommentThreads, type EditorComments } from "../../src/collab/comments";
import { mountSourceEditor, type SourceFileAccess } from "../../src/writing/editor";

// The core editor reports edits through onChange; the test types by calling the last one mounted.
const typed: { type?: (body: string) => void } = {};
jest.mock("@labshelf/core/dom", () => ({
  ...jest.requireActual("@labshelf/core/dom"),
  mountQmdEditor: (_root: HTMLElement, options: { onChange(body: string): void }) => {
    typed.type = options.onChange;
    return { setBody: () => {}, focus: () => {}, destroy: () => {} };
  },
}));

/** Waits for the Add comment dialog, types `text` in it and submits it, or dismisses it when `text` is undefined. */
async function answerDialog(text: string | undefined): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const form = document.body.querySelector("form")!;
  if (text === undefined) {
    form.querySelectorAll("button")[0]!.click();
    return;
  }
  typed.type!(text);
  form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
}

// Verifies the page's comment store persists add, reply and resolve in comments.qmd and leaves an invalid file untouched.
describe("comments", () => {
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
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as never;
  const SOURCE = "Intro\nWe use a strong baseline here.\n";
  const range = { start: SOURCE.indexOf("baseline"), end: SOURCE.indexOf("baseline") + 8 };

  function setup(extra: Record<string, string> = {}) {
    const files: Record<string, string> = { "/lib/p/main.tex": SOURCE, ...extra };
    const store = createCommentThreads({ fs: writableFs(files), session: { current: () => entry }, logger });
    return { files, store };
  }

  describe("comment threads", () => {
    it("persists an added comment, a reply and a resolve in comments.qmd", async () => {
      const { files, store } = setup();
      await store.addComment("p", "main.tex", range, "Which baseline?");
      const [added] = await store.threads("p", "main.tex");
      expect(added).toMatchObject({ file: "main.tex", line: 2, resolved: false, anchor: { quote: "baseline" } });
      await store.reply(added!.id, "The first one.");
      await store.resolve(added!.id);
      const [saved] = await store.threads("p");
      expect(saved!.comments.map((each) => each.body)).toEqual(["Which baseline?", "The first one."]);
      expect(saved!.resolved).toBe(true);
      expect(parseCommentsQmd(files["/lib/p/.labshelf/comments.qmd"]!)!.threads).toHaveLength(1);
    });

    it("tells subscribers the ranges of open threads after each change", async () => {
      const { store } = setup();
      const seen: unknown[] = [];
      const stop = store.commentAnchorsFor("p", "main.tex").subscribe((ranges) => seen.push(ranges));
      await store.addComment("p", "main.tex", range, "Which?");
      await new Promise((resolve) => setTimeout(resolve, 0));
      const [thread] = await store.threads("p");
      await store.resolve(thread!.id);
      await new Promise((resolve) => setTimeout(resolve, 0));
      stop();
      expect(seen).toEqual([[], [range], []]);
    });

    it("reports a thread whose text is gone as having no line", async () => {
      const { files, store } = setup();
      await store.addComment("p", "main.tex", range, "Which?");
      files["/lib/p/main.tex"] = "Completely different.\n";
      expect((await store.threads("p"))[0]!.line).toBeUndefined();
    });

    it("leaves an invalid comments.qmd as it is and refuses to read or write it", async () => {
      const { files, store } = setup({ "/lib/p/.labshelf/comments.qmd": "<<<<<<< ours\n" });
      await expect(store.threads("p")).rejects.toThrow(/Fix the file/);
      await expect(store.addComment("p", "main.tex", range, "x")).rejects.toThrow(/left as it is/);
      expect(files["/lib/p/.labshelf/comments.qmd"]).toBe("<<<<<<< ours\n");
    });

    it("rejects a project that is not the open one", async () => {
      const { store } = setup();
      await expect(store.threads("other")).rejects.toThrow(/not the open project/);
    });
  });
});

// The Add comment button leaves focus on the input box it opens, so typing never reaches the editor.
describe("commentSupport", () => {
  describe("add comment button", () => {
    it("leaves focus on the opened input box, not the editor", () => {
      const parent = document.createElement("div");
      document.body.append(parent);
      const input = document.createElement("input");
      document.body.append(input);
      const view = new EditorView({
        parent,
        state: EditorState.create({ doc: "hello world", selection: { anchor: 0, head: 5 }, extensions: [addCommentSupport(() => input.focus())] }),
      });
      parent.querySelector<HTMLButtonElement>(".ls-add-comment")!.click();
      expect(document.activeElement).toBe(input);
      view.destroy();
    });
  });
});

// Routed comments use a shared project's live threads while its share is connected and the comments.qmd store otherwise.
describe("commentRouting", () => {
  const entry = { kind: "ready", folder: "/lib/p", settings: { id: "p" } } as unknown as ProjectEntry;

  function fakeStore(label: string, ranges: TextRange[]) {
    const listeners = new Set<() => void>();
    const store = {
      threads: jest.fn(async () => [{ id: label }]),
      commentAnchorsFor: () => ({ subscribe: (listener: (r: TextRange[]) => void) => { listener(ranges); return () => undefined; } }),
      addComment: jest.fn(async () => undefined),
      reply: jest.fn(async () => undefined),
      resolve: jest.fn(async () => undefined),
      onDidChange: (listener: () => void) => { listeners.add(listener); return () => void listeners.delete(listener); },
    };
    return { store: store as unknown as CommentThreads & typeof store, listeners };
  }

  function setup() {
    const file = fakeStore("file", [{ start: 0, end: 1 }]);
    const live = fakeStore("live", [{ start: 5, end: 6 }]);
    let active: { comments: CommentThreads } | undefined;
    const changes = new Set<() => void>();
    const shares = { live: () => active, onChange: (l: () => void) => { changes.add(l); return () => void changes.delete(l); } };
    const routed = createRoutedCommentThreads({ files: file.store, shares: shares as never, session: { current: () => entry } });
    const setActive = (on: boolean): void => { active = on ? { comments: live.store } : undefined; changes.forEach((l) => l()); };
    return { file, live, routed, setActive };
  }

  describe("routed comment threads", () => {
    it("sends calls to the live threads while the project is shared and to the file store otherwise", async () => {
      const { file, live, routed, setActive } = setup();
      expect(await routed.threads("p")).toEqual([{ id: "file" }]);
      setActive(true);
      expect(await routed.threads("p")).toEqual([{ id: "live" }]);
      await routed.reply("t", "hi");
      await routed.resolve("t");
      await routed.addComment("p", "main.tex", { start: 0, end: 1 }, "x");
      expect(live.store.reply).toHaveBeenCalledWith("t", "hi");
      expect(live.store.resolve).toHaveBeenCalledWith("t");
      expect(live.store.addComment).toHaveBeenCalled();
      expect(file.store.reply).not.toHaveBeenCalled();
      setActive(false);
      await routed.resolve("t");
      expect(file.store.resolve).toHaveBeenCalledWith("t");
    });

    it("re-subscribes the anchors when the share opens and closes", () => {
      const { routed, setActive } = setup();
      const seen: TextRange[][] = [];
      const stop = routed.commentAnchorsFor("p", "main.tex").subscribe((ranges) => seen.push(ranges));
      setActive(true);
      setActive(false);
      expect(seen.map((r) => r[0]!.start)).toEqual([0, 5, 0]);
      stop();
      setActive(true);
      expect(seen).toHaveLength(3);
    });

    it("reports changes of the live threads once the share is active, and of the file store always", () => {
      const { file, live, routed, setActive } = setup();
      const changed = jest.fn();
      const stop = routed.onDidChange(changed);
      file.listeners.forEach((l) => l());
      expect(changed).toHaveBeenCalledTimes(1);
      setActive(true);
      expect(changed).toHaveBeenCalledTimes(2);
      live.listeners.forEach((l) => l());
      expect(changed).toHaveBeenCalledTimes(3);
      stop();
      expect(live.listeners.size).toBe(0);
      expect(file.listeners.size).toBe(0);
    });
  });
});

// The source editor marks the lines of unresolved comments, moves the marks with edits and adds comments on the selection.
describe("commentMarks", () => {
  const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

  async function mount(text: string, ranges: TextRange[], extra: { onSaved?: () => void } = {}) {
    const host = document.createElement("div");
    document.body.append(host);
    const added: Array<{ range: TextRange; text: string }> = [];
    const open = jest.fn();
    const comments: EditorComments = {
      subscribe: (listener) => { listener(ranges); return () => undefined; },
      add: async (range, body) => { added.push({ range, text: body }); },
      open,
    };
    const written: string[] = [];
    const files: SourceFileAccess = { list: async () => ["main.tex"], read: async () => text, write: async (_p, content) => { written.push(content); } };
    const editor = await mountSourceEditor(host, {
      projectId: "p", path: "main.tex", files, papers: async () => [], helper: undefined, logger, onDirty: () => undefined, comments, ...extra,
    });
    return { editor, host, view: EditorView.findFromDOM(host)!, added, open, written };
  }

  const markedText = (host: HTMLElement): string => [...host.querySelectorAll(".ls-comment-range")].map((node) => node.textContent).join("|");
  const markedLines = (host: HTMLElement): number => host.querySelectorAll(".ls-comment-marker").length;

  describe("comment marks", () => {
    it("marks the anchored range and the gutter of its line", async () => {
      const { editor, host } = await mount("one\ntwo\nthree\n", [{ start: 4, end: 7 }]);
      expect(markedText(host)).toBe("two");
      expect(markedLines(host)).toBe(1);
      await editor.dispose();
    });

    it("moves the marks with an edit before them", async () => {
      const { editor, host, view } = await mount("one\ntwo\n", [{ start: 4, end: 7 }]);
      view.dispatch({ changes: { from: 0, insert: "zero\n" } });
      expect(markedText(host)).toBe("two");
      await editor.dispose();
    });

    it("places ranges of a CRLF file on the LF document", async () => {
      const { editor, host } = await mount("one\r\ntwo\r\n", [{ start: 5, end: 8 }]);
      expect(markedText(host)).toBe("two");
      await editor.dispose();
    });

    it("opens the comments tab from a gutter marker", async () => {
      const { editor, host, open } = await mount("one\ntwo\n", [{ start: 4, end: 7 }]);
      host.querySelector<HTMLElement>(".ls-comment-marker")!.click();
      expect(open).toHaveBeenCalledTimes(1);
      await editor.dispose();
    });
  });

  describe("add comment", () => {
    const button = (host: HTMLElement): HTMLButtonElement => host.querySelector<HTMLButtonElement>(".ls-add-comment")!;

    it("is disabled while the selection is empty", async () => {
      const { editor, host, view } = await mount("one\ntwo\n", []);
      expect(button(host).disabled).toBe(true);
      view.dispatch({ selection: { anchor: 4, head: 7 } });
      expect(button(host).disabled).toBe(false);
      await editor.dispose();
    });

    it("adds the typed text on the selection, in file offsets, after saving", async () => {
      const { editor, host, view, added, written } = await mount("one\r\ntwo\r\n", []);
      view.dispatch({ changes: { from: 0, insert: "x" } });
      view.dispatch({ selection: { anchor: 5, head: 8 } });
      button(host).click();
      await answerDialog("check this");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(written).toEqual(["xone\r\ntwo\r\n"]);
      expect(added).toEqual([{ range: { start: 6, end: 9 }, text: "check this" }]);
      await editor.dispose();
    });

    it("adds nothing when the input is cancelled", async () => {
      const { editor, host, view, added } = await mount("one\ntwo\n", []);
      view.dispatch({ selection: { anchor: 4, head: 7 } });
      button(host).click();
      await answerDialog(undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(added).toEqual([]);
      await editor.dispose();
    });
  });

  describe("saved hook", () => {
    it("runs after a successful save", async () => {
      const onSaved = jest.fn();
      const { editor, view } = await mount("a", [], { onSaved });
      view.dispatch({ changes: { from: 0, insert: "b" } });
      await editor.flush();
      expect(onSaved).toHaveBeenCalledTimes(1);
      await editor.dispose();
    });
  });
});
