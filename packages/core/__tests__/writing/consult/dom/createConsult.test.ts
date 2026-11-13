/** @jest-environment jsdom */
// Tests createConsult: open mounts a floating window with the file's editable view, Open and close behave per kind, a failing openFile keeps the window with an
// error, dispose releases everything, choose and footer reach the chooser and the chips; and the @labshelf/core/consult entry.
import * as fs from "node:fs";
import * as path from "node:path";
import * as Y from "yjs";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import type { ConsultEntry, ConsultReply, ConsultRequest } from "../../../../src/writing/consult/consultRequests";
import type { EditableFile } from "../../../../src/writing/consult/dom/editableFile";
import { createConsult, type Consult, type ConsultOptions } from "../../../../src/writing/consult/dom/createConsult";
import * as consultEntry from "../../../../src/writing/consult/dom/index";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function flush(): Promise<void> { for (let i = 0; i < 6; i += 1) { await sleep(0); } }

const MAIN: ConsultEntry = { ref: { kind: "manuscript", projectId: "p1", path: "main.tex" }, label: "main.tex", detail: "Thesis" };
const OTHER: ConsultEntry = { ref: { kind: "manuscript", projectId: "p1", path: "intro.tex" }, label: "intro.tex" };
const PICKED: ConsultEntry = { ref: { kind: "pickedFile", id: "f1", name: "scratch.py" }, label: "scratch.py" };

interface Setup {
  consult: Consult;
  requests: ConsultRequest[];
  released: Map<string, jest.Mock>;
  opened: string[];
  onError: jest.Mock;
  root: HTMLElement;
}

function textFile(filePath: string, text: string, released: Map<string, jest.Mock>): EditableFile {
  const release = jest.fn();
  released.set(filePath, release);
  const ytext = new Y.Doc().getText("content");
  ytext.insert(0, text);
  return { kind: "text", path: filePath, binding: { collab: { text: ytext } }, release };
}

function setup(extra: Partial<ConsultOptions> = {}, entries: ConsultEntry[] = [MAIN, OTHER]): Setup {
  const requests: ConsultRequest[] = [];
  const released = new Map<string, jest.Mock>();
  const opened: string[] = [];
  const onError = jest.fn();
  const root = document.body.appendChild(document.createElement("div"));
  const client = async (request: ConsultRequest): Promise<ConsultReply> => {
    requests.push(request);
    if (request.kind === "list") { return { ok: true, value: { kind: "entries", entries, canBrowse: false } }; }
    if (request.kind === "open") { return { ok: true, value: { kind: "opened" } }; }
    return { ok: false, error: "unexpected request" };
  };
  const consult = createConsult({
    client,
    openFile: async (ref) => {
      const filePath = "path" in ref ? ref.path : ref.kind === "pickedFile" ? ref.name : "";
      opened.push(filePath);
      return textFile(filePath, `content of ${filePath}`, released);
    },
    pdfSource: () => { throw new Error("no PDF in this test"); },
    root, onError,
    ...extra,
  });
  return { consult, requests, released, opened, onError, root };
}

let current: Consult | undefined;
afterEach(async () => {
  await current?.dispose();
  current = undefined;
  document.body.replaceChildren();
});
const make = (extra: Partial<ConsultOptions> = {}, entries?: ConsultEntry[]): Setup => {
  const s = setup(extra, entries);
  current = s.consult;
  return s;
};

const openButton = (el: HTMLElement): HTMLButtonElement | null => el.querySelector<HTMLButtonElement>('button[aria-label="Open"]');
const closeButton = (el: HTMLElement): HTMLButtonElement => el.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
const viewIn = (el: HTMLElement): EditorView => EditorView.findFromDOM(el.querySelector<HTMLElement>(".cm-editor")!)!;

describe("createConsult.open", () => {
  it("8.2-f opens a floating window titled with the label", async () => {
    const { consult, root } = make();
    const win = await consult.open(MAIN);
    expect(win.title).toBe("main.tex");
    expect(consult.windows.list()).toEqual([win]);
    expect(root.contains(win.element)).toBe(true);
    expect(win.element.querySelector(".ls-floating-window-title")?.textContent).toBe("main.tex");
  });

  it("8.2-f shows a CodeMirror view of the opened file in the window body", async () => {
    const { consult, opened } = make();
    const win = await consult.open(MAIN);
    expect(opened).toEqual(["main.tex"]);
    expect(win.body.querySelector(".cm-editor")).not.toBeNull();
    expect(viewIn(win.body).state.doc.toString()).toBe("content of main.tex");
  });

  it("8.2-f releases the file exactly once when the window is closed", async () => {
    const { consult, released } = make();
    const win = await consult.open(MAIN);
    expect(released.get("main.tex")).not.toHaveBeenCalled();
    await win.close();
    await win.close();
    expect(released.get("main.tex")).toHaveBeenCalledTimes(1);
    expect(consult.windows.list()).toHaveLength(0);
  });

  it("8.2-f releases the file when the close button of the window is clicked", async () => {
    const { consult, released } = make();
    const win = await consult.open(MAIN);
    closeButton(win.element).click();
    await flush();
    expect(win.closed).toBe(true);
    expect(released.get("main.tex")).toHaveBeenCalledTimes(1);
  });

  it("8.2-f sends {kind:'open', ref} when the Open button is clicked", async () => {
    const { consult, requests } = make();
    const win = await consult.open(MAIN);
    const button = openButton(win.element);
    expect(button).not.toBeNull();
    button!.click();
    await flush();
    expect(requests.filter((request) => request.kind === "open")).toEqual([{ kind: "open", ref: MAIN.ref }]);
  });

  it("8.2-f gives a pickedFile window no Open button", async () => {
    const { consult } = make();
    const win = await consult.open(PICKED);
    expect(openButton(win.element)).toBeNull();
    expect(win.body.querySelector(".cm-editor")).not.toBeNull();
  });

  it("8.2-f opens a pickedFile through openFile with its ref", async () => {
    const refs: unknown[] = [];
    const { consult } = make({
      openFile: async (ref) => { refs.push(ref); return textFile("scratch.py", "x = 1", new Map()); },
    });
    await consult.open(PICKED);
    expect(refs).toEqual([PICKED.ref]);
  });

  it("8.2-f releases at once a file whose window was closed before openFile resolved, and mounts nothing", async () => {
    let resolveFile!: (file: EditableFile) => void;
    const released = new Map<string, jest.Mock>();
    const { consult } = make({ openFile: () => new Promise<EditableFile>((resolve) => { resolveFile = resolve; }) });
    const opening = consult.open(MAIN);
    await flush();
    const [win] = consult.windows.list();
    expect(win).toBeDefined();
    await win!.close();
    resolveFile(textFile("main.tex", "late", released));
    await opening;
    expect(released.get("main.tex")).toHaveBeenCalledTimes(1);
    expect(win!.body.querySelector(".cm-editor")).toBeNull();
  });
});

describe("createConsult.open of a file that cannot be opened", () => {
  it("8.2-g shows .ls-consult-error with the label in the window body and calls onError, leaving the window open", async () => {
    const failure = new Error("disk gone");
    const { consult, onError } = make({ openFile: async () => { throw failure; } });
    const win = await consult.open(MAIN);
    const error = win.body.querySelector(".ls-consult-error");
    expect(error).not.toBeNull();
    expect(error!.textContent).toContain("Could not open main.tex");
    expect(error!.textContent).toContain("disk gone");
    expect(onError).toHaveBeenCalledWith(failure);
    expect(win.closed).toBe(false);
    expect(consult.windows.list()).toEqual([win]);
  });

  it("8.2-g closes a window that holds the error without throwing", async () => {
    const { consult } = make({ openFile: async () => { throw new Error("nope"); } });
    const win = await consult.open(MAIN);
    await expect(win.close()).resolves.toBeUndefined();
    expect(consult.windows.list()).toHaveLength(0);
  });
});

describe("createConsult.dispose", () => {
  it("8.2-g closes every window and releases every opened file", async () => {
    const { consult, released, root } = make();
    await consult.open(MAIN);
    await consult.open(OTHER);
    await consult.open(PICKED);
    expect(consult.windows.list()).toHaveLength(3);
    await consult.dispose();
    expect(consult.windows.list()).toHaveLength(0);
    expect(root.querySelector(".ls-floating-window")).toBeNull();
    for (const name of ["main.tex", "intro.tex", "scratch.py"]) {
      expect(released.get(name)).toHaveBeenCalledTimes(1);
    }
  });

  it("8.2-g does not release a file twice when a window was closed before dispose", async () => {
    const { consult, released } = make();
    const win = await consult.open(MAIN);
    await consult.open(OTHER);
    await win.close();
    await consult.dispose();
    expect(released.get("main.tex")).toHaveBeenCalledTimes(1);
    expect(released.get("intro.tex")).toHaveBeenCalledTimes(1);
  });
});

describe("createConsult.choose and footer", () => {
  const combobox = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>("input[role=combobox]");
  async function pickFirst(): Promise<void> {
    const input = combobox()!;
    input.dispatchEvent(new Event("focus"));
    document.querySelector<HTMLElement>(".ls-combobox-option")!.click();
    await flush();
  }

  it("8.2-h choose() opens the chooser and asks for the list", async () => {
    const { consult, requests } = make();
    consult.choose();
    await flush();
    expect(document.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(requests.filter((request) => request.kind === "list")).toHaveLength(1);
    expect(combobox()).not.toBeNull();
  });

  it("8.2-h picking an entry in the chooser opens its window", async () => {
    const { consult, released } = make();
    consult.choose();
    await flush();
    await pickFirst();
    expect(consult.windows.list().map((win) => win.title)).toEqual(["main.tex"]);
    expect(viewIn(consult.windows.list()[0]!.body).state.doc.toString()).toBe("content of main.tex");
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    expect(released.get("main.tex")).not.toHaveBeenCalled();
  });

  it("8.2-h remembers the chooser's kind for the next choose()", async () => {
    const { consult, requests } = make();
    consult.choose();
    await flush();
    const manuscript = [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find((radio) => radio.textContent === "Manuscript")!;
    manuscript.click();
    await flush();
    await pickFirst();
    requests.length = 0;
    consult.choose();
    await flush();
    const lists = requests.filter((request) => request.kind === "list");
    expect(lists[0]).toEqual({ kind: "list", what: "manuscript" });
  });

  it("8.2-h footer() is an Extension whose chips list the open windows in open order", async () => {
    const { consult } = make();
    const parent = document.body.appendChild(document.createElement("div"));
    const view = new EditorView({ state: EditorState.create({ doc: "x", extensions: [consult.footer()] }), parent });
    expect(parent.querySelector(".ls-consult-footer")).not.toBeNull();
    expect(parent.querySelectorAll(".ls-consult-chip")).toHaveLength(0);
    await consult.open(MAIN);
    await consult.open(OTHER);
    const chips = [...parent.querySelectorAll<HTMLElement>(".ls-consult-chip")];
    expect(chips.map((chip) => chip.textContent)).toEqual([expect.stringContaining("main.tex"), expect.stringContaining("intro.tex")]);
    view.destroy();
  });

  it("8.2-h the Consult button of the footer opens the chooser", async () => {
    const { consult, requests } = make();
    const parent = document.body.appendChild(document.createElement("div"));
    const view = new EditorView({ state: EditorState.create({ doc: "x", extensions: [consult.footer()] }), parent });
    const button = [...parent.querySelectorAll<HTMLButtonElement>(".ls-consult-footer button")].find((each) => (each.textContent ?? "").includes("Consult"))!;
    button.click();
    await flush();
    expect(document.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(requests.some((request) => request.kind === "list")).toBe(true);
    view.destroy();
  });
});

describe("the @labshelf/core/consult entry", () => {
  it("8.2-i package.json exports ./consult pointing at src/writing/consult/dom/index.ts", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../package.json"), "utf8")) as { exports: Record<string, unknown> };
    expect(manifest.exports["./consult"]).toBe("./src/writing/consult/dom/index.ts");
  });

  it("8.2-i the index exports the consult controller, its views, the chooser, the footer, the client and the replica binding", () => {
    for (const name of ["createConsult", "mountEditableView", "mountPaperView", "openConsultChooser", "createConsultFooter", "askConsult", "editableFromReplica", "consultKindIcon"]) {
      expect(typeof (consultEntry as Record<string, unknown>)[name]).toBe("function");
    }
  });
});
