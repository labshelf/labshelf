/** @jest-environment jsdom */
// Tests mountEditableView: a text file bound by collab (a Y.Text) or by a SourceDocument, a qmd file bound by items, release exactly once, and that two
// document views of one source authority converge; and mountPaperView's error path.
import * as Y from "yjs";
import { EditorView } from "@codemirror/view";
import { createSourceAuthority, type SourceAuthority, type SourceUpdate } from "../../../../src/writing/authority";
import type { SourceDocument } from "../../../../src/writing/dom/sourceEditor/documentMode";
import type { EditableFile } from "../../../../src/writing/consult/dom/editableFile";
import type { ConsultClient } from "../../../../src/writing/consult/dom/consultClient";
import { undoSharedEdit } from "../../../../src/collab/dom/editorCollab";
import { mountEditableView } from "../../../../src/writing/consult/dom/editableView";
import { mountPaperView } from "../../../../src/writing/consult/dom/paperView";

type Listener = Parameters<SourceDocument["subscribe"]>[0];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** Lets the views' scheduled pushes (an animation frame or 16 ms) and the host's confirmations run. */
async function settle(): Promise<void> { for (let i = 0; i < 4; i += 1) { await sleep(40); } }

function newBody(): HTMLElement {
  return document.body.appendChild(document.createElement("div"));
}
function viewIn(body: HTMLElement): EditorView {
  const dom = body.querySelector<HTMLElement>(".cm-editor");
  if (!dom) { throw new Error("no CodeMirror view in the body"); }
  const view = EditorView.findFromDOM(dom);
  if (!view) { throw new Error("no EditorView for the .cm-editor"); }
  return view;
}

afterEach(() => { document.body.replaceChildren(); });

describe("mountEditableView over a collab text binding", () => {
  function collabFile(initial: string): { file: Extract<EditableFile, { kind: "text" }>; ytext: Y.Text; release: jest.Mock } {
    const ytext = new Y.Doc().getText("content");
    ytext.insert(0, initial);
    const release = jest.fn();
    return { file: { kind: "text", path: "src/a.py", binding: { collab: { text: ytext } }, release }, ytext, release };
  }

  it("8.2-a shows the text of the Y.Text in a CodeMirror view", () => {
    const { file } = collabFile("hello");
    const body = newBody();
    mountEditableView(body, file);
    expect(viewIn(body).state.doc.toString()).toBe("hello");
  });

  it("8.2-a lands a user insert of the view in the Y.Text", () => {
    const { file, ytext } = collabFile("hello");
    const body = newBody();
    mountEditableView(body, file);
    viewIn(body).dispatch({ changes: { from: 5, insert: " world" } });
    expect(ytext.toString()).toBe("hello world");
  });

  it("8.2-a shows a Y.Text change of another origin in the view", () => {
    const { file, ytext } = collabFile("hello");
    const body = newBody();
    mountEditableView(body, file);
    ytext.doc!.transact(() => ytext.insert(0, ">> "), "peer");
    expect(viewIn(body).state.doc.toString()).toBe(">> hello");
  });

  it("8.2-a undoes only this view's own edit, not a peer's", async () => {
    const { undo } = await import("@codemirror/commands");
    const { file, ytext } = collabFile("hello");
    const body = newBody();
    mountEditableView(body, file);
    const view = viewIn(body);
    ytext.doc!.transact(() => ytext.insert(0, ">> "), "peer");
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    expect(ytext.toString()).toBe(">> hello!");
    expect(undo(view)).toBe(false);
    expect(ytext.toString()).toBe(">> hello!");
    expect(undoSharedEdit(view)).toBe(true);
    expect(ytext.toString()).toBe(">> hello");
  });

  it("8.2-a labels the view with the file path", () => {
    const { file } = collabFile("x");
    const body = newBody();
    mountEditableView(body, file);
    expect(body.querySelector(".cm-content")?.getAttribute("aria-label")).toBe("src/a.py");
  });

  it("8.2-c releases the file exactly once however often destroy is called, and removes the view", async () => {
    const { file, release } = collabFile("x");
    const body = newBody();
    const handle = mountEditableView(body, file);
    await handle.flush();
    expect(release).not.toHaveBeenCalled();
    await handle.destroy();
    await handle.destroy();
    expect(release).toHaveBeenCalledTimes(1);
    expect(body.querySelector(".cm-editor")).toBeNull();
  });
});

/** A host with one authority and the documents of its views: a push goes to the authority, then every subscriber gets the updates since its base. */
function createHost(initial: string, options: { failPush?: boolean } = {}) {
  const authority: SourceAuthority = createSourceAuthority({ text: initial, lineBreak: "\n" });
  const subscribers = new Set<Listener>();
  const pushed: Array<{ version: number; updates: SourceUpdate[] }> = [];
  const saves: number[] = [];
  const makeDocument = (): SourceDocument => ({
    text: authority.text(), lineBreak: "\n", version: authority.version, dirty: false,
    push(version, updates) {
      if (options.failPush) { throw new Error("push failed"); }
      pushed.push({ version, updates });
      authority.receive(version, updates);
      const since = authority.since(version);
      for (const listener of [...subscribers]) { listener.updates(authority.version, since); }
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => { subscribers.delete(listener); };
    },
    save() { saves.push(authority.version); },
  });
  return { authority, subscribers, pushed, saves, makeDocument };
}

function documentFile(document: SourceDocument, path = "src/main.tex"): { file: EditableFile; release: jest.Mock } {
  const release = jest.fn();
  return { file: { kind: "text", path, binding: { document }, release }, release };
}

describe("mountEditableView over a SourceDocument binding", () => {
  it("8.2-b shows the document text", () => {
    const host = createHost("hello");
    const body = newBody();
    mountEditableView(body, documentFile(host.makeDocument()).file);
    expect(viewIn(body).state.doc.toString()).toBe("hello");
  });

  it("8.2-b shows a CRLF document with LF line ends", () => {
    const host = createHost("a\nb");
    const document: SourceDocument = { ...host.makeDocument(), text: "a\r\nb", lineBreak: "\r\n" };
    const body = newBody();
    mountEditableView(body, documentFile(document).file);
    expect(viewIn(body).state.doc.toString()).toBe("a\nb");
  });

  it("8.2-b converges two views of one authority after interleaved edits in both", async () => {
    const host = createHost("hello");
    const bodyA = newBody();
    const bodyB = newBody();
    mountEditableView(bodyA, documentFile(host.makeDocument()).file);
    mountEditableView(bodyB, documentFile(host.makeDocument()).file);
    const a = viewIn(bodyA);
    const b = viewIn(bodyB);

    // Both edit before either has pushed.
    a.dispatch({ changes: { from: 0, insert: "A1 " } });
    b.dispatch({ changes: { from: 5, insert: " B1" } });
    await settle();
    expect(a.state.doc.toString()).toBe("A1 hello B1");
    expect(b.state.doc.toString()).toBe("A1 hello B1");

    // And again, at the two ends.
    a.dispatch({ changes: { from: a.state.doc.length, insert: "!" } });
    b.dispatch({ changes: { from: 0, insert: ">" } });
    await settle();

    const text = a.state.doc.toString();
    expect(b.state.doc.toString()).toBe(text);
    expect(host.authority.text()).toBe(text);
    expect(text).toContain("A1 hello B1");
    expect(text.startsWith(">") || text.includes(">A1")).toBe(true);
    expect(text.endsWith("!")).toBe(true);
  });

  it("8.2-b converges when both views insert at the same position", async () => {
    const host = createHost("ab");
    const bodyA = newBody();
    const bodyB = newBody();
    mountEditableView(bodyA, documentFile(host.makeDocument()).file);
    mountEditableView(bodyB, documentFile(host.makeDocument()).file);
    const a = viewIn(bodyA);
    const b = viewIn(bodyB);
    a.dispatch({ changes: { from: 1, insert: "X" } });
    b.dispatch({ changes: { from: 1, insert: "Y" } });
    await settle();
    const text = a.state.doc.toString();
    expect(b.state.doc.toString()).toBe(text);
    expect(host.authority.text()).toBe(text);
    expect([...text].sort().join("")).toBe("XYab");
    expect(text.startsWith("a")).toBe(true);
    expect(text.endsWith("b")).toBe(true);
  });

  it("8.2-b gives each view its own client id", async () => {
    const host = createHost("hello");
    const bodyA = newBody();
    const bodyB = newBody();
    mountEditableView(bodyA, documentFile(host.makeDocument()).file);
    mountEditableView(bodyB, documentFile(host.makeDocument()).file);
    viewIn(bodyA).dispatch({ changes: { from: 0, insert: "a" } });
    await settle();
    viewIn(bodyB).dispatch({ changes: { from: 0, insert: "b" } });
    await settle();
    const ids = host.pushed.flatMap((push) => push.updates.map((update) => update.clientID));
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^consult-/);
    expect(ids[1]).toMatch(/^consult-/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("8.2-b asks the document to save on Mod-s", async () => {
    const host = createHost("hello");
    const body = newBody();
    mountEditableView(body, documentFile(host.makeDocument()).file);
    const view = viewIn(body);
    view.dispatch({ changes: { from: 5, insert: "!" } });
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", keyCode: 83, ctrlKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(host.saves.length).toBeGreaterThanOrEqual(1);
    expect(host.authority.text()).toBe("hello!");
  });

  it("8.2-c flush sends the pending edits to the host before it resolves", async () => {
    const host = createHost("hello");
    const body = newBody();
    const handle = mountEditableView(body, documentFile(host.makeDocument()).file);
    viewIn(body).dispatch({ changes: { from: 5, insert: "!" } });
    expect(host.pushed).toHaveLength(0);
    await handle.flush();
    expect(host.pushed).toHaveLength(1);
    expect(host.authority.text()).toBe("hello!");
  });

  it("8.2-c destroy awaits the flush: the host has the pending edit before destroy resolves", async () => {
    const host = createHost("hello");
    const body = newBody();
    const { file, release } = documentFile(host.makeDocument());
    const handle = mountEditableView(body, file);
    viewIn(body).dispatch({ changes: { from: 5, insert: "!" } });
    expect(host.pushed).toHaveLength(0);
    await handle.destroy();
    expect(host.pushed).toHaveLength(1);
    expect(host.authority.text()).toBe("hello!");
    expect(release).toHaveBeenCalledTimes(1);
    expect(host.subscribers.size).toBe(0);
    expect(body.querySelector(".cm-editor")).toBeNull();
  });

  it("8.2-c releases exactly once when destroy is called twice", async () => {
    const host = createHost("hello");
    const body = newBody();
    const { file, release } = documentFile(host.makeDocument());
    const handle = mountEditableView(body, file);
    await handle.destroy();
    await handle.destroy();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("8.2-c releases exactly once when destroy is called twice at once", async () => {
    const host = createHost("hello");
    const body = newBody();
    const { file, release } = documentFile(host.makeDocument());
    const handle = mountEditableView(body, file);
    await Promise.all([handle.destroy(), handle.destroy()]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("8.2-c releases exactly once even when the flush rejects", async () => {
    const host = createHost("hello", { failPush: true });
    const body = newBody();
    const { file, release } = documentFile(host.makeDocument());
    const handle = mountEditableView(body, file);
    viewIn(body).dispatch({ changes: { from: 5, insert: "!" } });
    await handle.destroy().catch(() => undefined);
    await handle.destroy().catch(() => undefined);
    expect(release).toHaveBeenCalledTimes(1);
    expect(body.querySelector(".cm-editor")).toBeNull();
  });
});

describe("mountEditableView over a non-live qmd binding", () => {
  const ID_A = "n-01JABCDEFGHJKMNPQRSTVWXYZ0";
  const ID_B = "n-01JABCDEFGHJKMNPQRSTVWXYZ1";
  const item = (id: string, body: string): string => `::: {#${id} .labshelf-item}\n${body}\n:::\n`;
  const FILE = `---\ntitle: x\n---\n\n${item(ID_A, "First item")}\n${item(ID_B, "Second item")}`;

  function qmdFile() {
    const release = jest.fn();
    const unsubscribe = jest.fn();
    let listener: ((text: string) => void) | undefined;
    const subscribe = jest.fn((next: (text: string) => void) => { listener = next; return unsubscribe; });
    const file: EditableFile = { kind: "qmd", path: "notes/a.qmd", binding: { text: FILE, save: jest.fn(), subscribe }, release };
    return { file, release, unsubscribe, subscribe, push: (text: string) => listener!(text) };
  }
  const cards = (body: HTMLElement): HTMLElement[] => [...body.querySelectorAll<HTMLElement>(".qmd-note-file-item")];

  it("8.2-d mounts a note editor with the items of binding.text", () => {
    const { file } = qmdFile();
    const body = newBody();
    mountEditableView(body, file);
    expect(cards(body).map((card) => card.dataset["itemId"])).toEqual([ID_A, ID_B]);
    expect(cards(body)[0]!.textContent).toContain("First item");
    expect(cards(body)[1]!.textContent).toContain("Second item");
  });

  it("8.2-d subscribes to the binding and shows a new text of its callback", () => {
    const { file, subscribe, push } = qmdFile();
    const body = newBody();
    mountEditableView(body, file);
    expect(subscribe).toHaveBeenCalledTimes(1);
    push(FILE.replace("Second item", "Changed outside"));
    expect(cards(body)[1]!.textContent).toContain("Changed outside");
    expect(cards(body)[1]!.textContent).not.toContain("Second item");
  });

  it("8.2-d destroy unsubscribes and releases once, also when called twice", async () => {
    const { file, release, unsubscribe } = qmdFile();
    const body = newBody();
    const handle = mountEditableView(body, file);
    await handle.destroy();
    await handle.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(body.querySelector(".qmd-note-file-item")).toBeNull();
  });

  it("8.2-d flush of a non-live binding resolves", async () => {
    const { file } = qmdFile();
    const body = newBody();
    const handle = mountEditableView(body, file);
    await expect(handle.flush()).resolves.toBeUndefined();
  });
});

describe("mountPaperView", () => {
  const pdfSource = (): never => { throw new Error("the PDF must not be opened"); };

  it("8.2-e shows an .ls-consult-error in the body when the paperPdf reply is not ok, and ready resolves", async () => {
    const requests: string[] = [];
    const client: ConsultClient = async (request) => {
      requests.push(request.kind);
      if (request.kind === "paperPdf") { return { ok: false, error: "no such pdf" }; }
      return { ok: true, value: { kind: "marks", annotations: [], notesText: null } };
    };
    const body = newBody();
    const view = mountPaperView(body, { client, paperId: "p1", pdfSource });
    await expect(view.ready).resolves.toBeUndefined();
    const error = body.querySelector(".ls-consult-error");
    expect(error).not.toBeNull();
    expect(error!.textContent).toContain("Could not open the paper");
    expect(error!.textContent).toContain("no such pdf");
    expect([...requests].sort()).toEqual(["paperMarks", "paperPdf"]);
    expect(() => view.destroy()).not.toThrow();
  });

  it("8.2-e shows the error and resolves ready when the client rejects", async () => {
    const client: ConsultClient = async () => { throw new Error("host gone"); };
    const body = newBody();
    const view = mountPaperView(body, { client, paperId: "p1", pdfSource });
    await expect(view.ready).resolves.toBeUndefined();
    expect(body.querySelector(".ls-consult-error")?.textContent).toContain("host gone");
  });
});
