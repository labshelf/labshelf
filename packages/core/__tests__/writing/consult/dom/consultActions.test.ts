/** @jest-environment jsdom */
// Tests what consult windows write into their surface: the editor's ConsultActions (cite, list code with the host's path, Link output), the code
// window's Insert whole file bar, Consult on a kind with Link output…, the manuscript windows the reader cites into, the chips-only footer,
// and the reader's Cite in <file> menu choices.
import * as Y from "yjs";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ConsultEntry, ConsultReply, ConsultRequest } from "../../../../src/writing/consult/consultRequests";
import type { ConsultActions } from "../../../../src/writing/consult/dom/consultActions";
import { createConsult, type Consult, type ConsultOptions } from "../../../../src/writing/consult/dom/createConsult";
import { createEditorConsultActions } from "../../../../src/writing/consult/dom/editorActions";
import { deriveSelectedLines } from "../../../../src/writing/consult/dom/textWindow";
import { openQuoteMenu, setQuoteMenuExtras } from "../../../../src/reader/dom/selectionBubble";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function flush(): Promise<void> { for (let i = 0; i < 6; i += 1) { await sleep(0); } }

const MAIN: ConsultEntry = { ref: { kind: "manuscript", projectId: "p1", path: "main.tex" }, label: "main.tex" };
const INTRO: ConsultEntry = { ref: { kind: "manuscript", projectId: "p1", path: "intro.tex" }, label: "intro.tex" };
const CODE: ConsultEntry = { ref: { kind: "code", path: "analysis/fit.py" }, label: "fit.py" };

const FIT = "import numpy\n\ndef fit(x):\n    return x\n";

function make(extra: Partial<ConsultOptions> = {}): Consult {
  const client = async (request: ConsultRequest): Promise<ConsultReply> => {
    if (request.kind === "list") { return { ok: true, value: { kind: "entries", entries: [MAIN, CODE], canBrowse: false } }; }
    return { ok: true, value: { kind: "opened" } };
  };
  return createConsult({
    client,
    openFile: async (ref) => {
      const filePath = "path" in ref ? ref.path : "picked";
      const text = new Y.Doc().getText("content");
      text.insert(0, filePath.endsWith(".py") ? FIT : `content of ${filePath}`);
      return { kind: "text", path: filePath, binding: { collab: { text } }, release: jest.fn() };
    },
    pdfSource: () => { throw new Error("no PDF in this test"); },
    root: document.body.appendChild(document.createElement("div")),
    ...extra,
  });
}

let current: Consult | undefined;
afterEach(async () => {
  await current?.dispose();
  current = undefined;
  setQuoteMenuExtras(undefined);
  document.body.replaceChildren();
});

function listingActions(over: Partial<ConsultActions> = {}): ConsultActions & { insertListing: jest.Mock } {
  return {
    cite: jest.fn(async () => undefined), citationText: jest.fn(async () => "\\cite{k}"),
    insertListing: jest.fn(async () => undefined), canList: () => true, ...over,
  } as ConsultActions & { insertListing: jest.Mock };
}

describe("createEditorConsultActions", () => {
  const scopedCiting = { text: jest.fn(async () => "\\cite[p.~2]{k}"), cite: jest.fn(async () => undefined) };

  it("cites through the editor's scoped citing and gives its exact text", async () => {
    const actions = createEditorConsultActions({ scopedCiting, insertCodeExcerpt: undefined, outputLinks: undefined })!;
    await actions.cite("p", { kind: "page", page: 2 }, false);
    expect(scopedCiting.cite).toHaveBeenCalledWith("p", { kind: "page", page: 2 }, false);
    await expect(actions.citationText("p", { kind: "page", page: 2 }, false)).resolves.toBe("\\cite[p.~2]{k}");
    expect(actions.insertListing).toBeUndefined();
    expect(actions.linkOutput).toBeUndefined();
  });

  it("lists code under the path the host gives, and only the files that have one", async () => {
    const insertCodeExcerpt = jest.fn(async () => undefined);
    const actions = createEditorConsultActions({ scopedCiting, insertCodeExcerpt, outputLinks: undefined }, (ref) => (ref.kind === "code" ? `../${ref.path}` : undefined))!;
    expect(actions.canList!({ kind: "code", path: "a.py" })).toBe(true);
    expect(actions.canList!({ kind: "pickedFile", id: "f", name: "b.py" })).toBe(false);
    await actions.insertListing!({ kind: "code", path: "analysis/fit.py" }, "x = 1\ny = 2\n", 1, 1);
    expect(insertCodeExcerpt).toHaveBeenCalledWith({ path: "../analysis/fit.py", anchor: { kind: "lines", start: 2, end: 2 }, code: "y = 2" });
    await expect(actions.insertListing!({ kind: "pickedFile", id: "f", name: "b.py" }, "x", 0, 0)).rejects.toThrow(/cannot be linked/);
  });

  it("opens Link output, and is undefined for an editor that cannot cite", () => {
    const insert = jest.fn(async () => undefined);
    createEditorConsultActions({ scopedCiting, insertCodeExcerpt: undefined, outputLinks: { insert } as never })!.linkOutput!();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(createEditorConsultActions({ scopedCiting: undefined, insertCodeExcerpt: undefined, outputLinks: undefined })).toBeUndefined();
  });
});

describe("deriveSelectedLines", () => {
  const view = (anchor: number, head: number): EditorView => new EditorView({ state: EditorState.create({ doc: "a\nb\nc\n", selection: { anchor, head } }) });

  it("gives the 0-based lines a selection covers, leaving out a line it only reaches the start of", () => {
    expect(deriveSelectedLines(view(0, 0))).toBeUndefined();
    expect(deriveSelectedLines(view(0, 3))).toEqual({ start: 0, end: 1 });
    expect(deriveSelectedLines(view(0, 4))).toEqual({ start: 0, end: 1 });
    expect(deriveSelectedLines(view(2, 3))).toEqual({ start: 1, end: 1 });
  });
});

describe("a code window", () => {
  it("lists the whole file from its bar while the editor can list it", async () => {
    const actions = listingActions();
    current = make({ actions: () => actions });
    const win = await current.open(CODE);
    await flush();
    const bar = win.body.querySelector<HTMLElement>(".ls-consult-actions")!;
    expect(bar.hidden).toBe(false);
    bar.querySelector("button")!.click();
    expect(actions.insertListing).toHaveBeenCalledWith(CODE.ref, FIT, 0, 4);
  });

  it("hides the bar without actions or for a file the editor cannot link", async () => {
    current = make();
    expect((await current.open(CODE)).body.querySelector<HTMLElement>(".ls-consult-actions")!.hidden).toBe(true);
    await current.dispose();
    current = make({ actions: () => listingActions({ canList: () => false }) });
    expect((await current.open(CODE)).body.querySelector<HTMLElement>(".ls-consult-actions")!.hidden).toBe(true);
  });

  it("gives a manuscript no bar", async () => {
    current = make({ actions: () => listingActions() });
    expect((await current.open(MAIN)).body.querySelector(".ls-consult-actions")).toBeNull();
  });
});

describe("Consult's chooser", () => {
  it("opens on the kind asked for, and offers Link output… when the editor links outputs", async () => {
    const linkOutput = jest.fn();
    current = make({ actions: () => listingActions({ linkOutput }) });
    current.choose("code");
    await flush();
    expect(document.querySelector('.ls-consult-kind[aria-checked="true"]')!.textContent).toBe("Code");
    const link = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Link output...")!;
    link.click();
    expect(linkOutput).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".ls-consult-kinds")).toBeNull();
  });

  it("offers no Link output… without it", async () => {
    current = make({ actions: () => listingActions() });
    current.choose();
    await flush();
    expect([...document.querySelectorAll("button")].some((button) => button.textContent === "Link output...")).toBe(false);
  });
});

describe("the manuscript windows", () => {
  it("lists the open ones with their views, the one used last first, and drops a closed one", async () => {
    current = make();
    const main = await current.open(MAIN);
    const intro = await current.open(INTRO);
    await flush();
    expect(current.manuscripts().map((found) => found.ref.path)).toEqual(["intro.tex", "main.tex"]);
    main.element.dispatchEvent(new FocusEvent("focusin"));
    expect(current.manuscripts().map((found) => found.ref.path)).toEqual(["main.tex", "intro.tex"]);
    expect(current.manuscripts()[0]!.view.state.doc.toString()).toBe("content of main.tex");
    await intro.close();
    expect(current.manuscripts().map((found) => found.title)).toEqual(["main.tex"]);
  });
});

describe("the chips-only footer", () => {
  it("shows only while a window is open", async () => {
    current = make();
    const view = new EditorView({ state: EditorState.create({ extensions: [current.footer({ button: false })] }), parent: document.body });
    const footer = document.querySelector<HTMLElement>(".ls-consult-footer")!;
    expect(footer.hidden).toBe(true);
    expect(footer.querySelector(".ls-consult-button")).toBeNull();
    const win = await current.open(MAIN);
    expect(footer.hidden).toBe(false);
    await win.close();
    expect(footer.hidden).toBe(true);
    view.destroy();
  });
});

describe("the reader's quote menu", () => {
  it("adds the page's extra choices with the citation it was opened for", () => {
    const run = jest.fn();
    const extras = jest.fn(() => [{ label: "Cite in main.tex", icon: "book-open" as const, run }]);
    setQuoteMenuExtras(extras);
    const anchor = document.body.appendChild(document.createElement("button"));
    openQuoteMenu(anchor, { label: "Copy citation", icon: "copy", run: () => undefined }, () => undefined, "below", { page: 3, quote: "words" });
    const labels = [...document.querySelectorAll(".rd-menu-item")].map((item) => item.textContent);
    expect(labels).toEqual(["Copy citation", "Cite in a project…", "Cite in main.tex"]);
    expect(extras).toHaveBeenCalledWith({ page: 3, quote: "words" });
    [...document.querySelectorAll<HTMLButtonElement>(".rd-menu-item")][2]!.click();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
