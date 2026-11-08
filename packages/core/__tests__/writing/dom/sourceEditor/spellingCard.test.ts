/** @jest-environment jsdom */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { undo } from "@codemirror/commands";
import { history } from "@codemirror/commands";
import { forceLinting, forEachDiagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { DictionaryFiles, DictionaryStore } from "../../../../src/writing/proofing/port.js";
import { createProofing, proofingStateOf } from "../../../../src/writing/dom/sourceEditor/proofing.js";
import { withoutSpelling } from "../../../../src/writing/dom/sourceEditor/spellingCard.js";

function readDictionary(pkg: string): DictionaryFiles | undefined {
  const candidates = [join(process.cwd(), "node_modules", pkg), join(process.cwd(), "packages", "core", "node_modules", pkg)];
  const folder = candidates.find((candidate) => existsSync(join(candidate, "index.aff")));
  if (!folder) return undefined;
  return { aff: new Uint8Array(readFileSync(join(folder, "index.aff"))), dic: new Uint8Array(readFileSync(join(folder, "index.dic"))) };
}

const en = readDictionary("dictionary-en");
const pt = readDictionary("dictionary-pt");
const describeWithDictionaries = en && pt ? describe : describe.skip;

interface FakeStore extends DictionaryStore { added: string[] }

function fakeStore(): FakeStore {
  const added: string[] = [];
  return {
    added,
    list: async () => ["en-US", "pt-BR"],
    read: async (tag) => (tag.startsWith("pt") ? pt! : en!),
    install: async () => undefined,
    userWords: async () => [...added],
    addUserWord: async (word) => { added.push(word); },
  };
}

const views: EditorView[] = [];

function makeView(doc: string, store: DictionaryStore): EditorView {
  const extensions = [history(), createProofing({ store, enabled: true, disable: () => undefined }, "latex")];
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions }) });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = "";
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, what: string, timeout = 15_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${what}`);
    await sleep(10);
  }
}

function spellingWords(view: EditorView): string[] {
  const out: string[] = [];
  forEachDiagnostic(view.state, (d, from, to) => { if (d.source === "spelling") out.push(view.state.sliceDoc(from, to)); });
  return out;
}

async function linted(view: EditorView): Promise<void> {
  await until(() => proofingStateOf(view.state)?.status === "ready", "the checker");
  for (let round = 0; round < 3; round += 1) {
    forceLinting(view);
    await sleep(30);
  }
}

const card = (): HTMLElement | null => document.querySelector(".ls-spelling-card");

async function caretCard(view: EditorView, at: number): Promise<HTMLElement> {
  view.focus();
  view.dispatch({ selection: { anchor: at } });
  await until(() => card()?.querySelector(".ls-spelling-card-word, .ls-spelling-card-note:not([aria-busy])") != null, "the card");
  return card()!;
}

const PT = "\\documentclass{article}\n\\usepackage[brazilian]{babel}\n\\begin{document}\nEu nao sei.\n\\end{document}\n";

describeWithDictionaries("spelling card", () => {
  it("opens over a misspelled word under the caret with one correction and two icon buttons, and replaces it in one undo step", async () => {
    const view = makeView(PT, fakeStore());
    await linted(view);
    const at = PT.indexOf("nao");
    const dom = await caretCard(view, at + 1);
    const word = dom.querySelector<HTMLButtonElement>("button.ls-spelling-card-word")!;
    expect(word.textContent).toBe("não");
    const icons = [...dom.querySelectorAll<HTMLButtonElement>("button.ls-spelling-card-icon")];
    expect(icons.map((b) => [b.getAttribute("aria-label"), b.title])).toEqual([["Ignore", "Ignore"], ["Add to dictionary", "Add to dictionary"]]);
    expect(dom.textContent).not.toContain("dictionary.");
    word.click();
    expect(view.state.doc.toString()).toBe(PT.replace("nao", "não"));
    expect(card()).toBeNull();
    undo(view);
    expect(view.state.doc.toString()).toBe(PT);
  }, 30_000);

  it("opens at the end of the word too", async () => {
    const view = makeView(PT, fakeStore());
    await linted(view);
    await caretCard(view, PT.indexOf("nao") + 3);
    expect(card()).not.toBeNull();
  }, 30_000);

  it("ignores the word in this file from the card", async () => {
    const view = makeView(PT, fakeStore());
    await linted(view);
    const dom = await caretCard(view, PT.indexOf("nao") + 1);
    dom.querySelector<HTMLButtonElement>('button[aria-label="Ignore"]')!.click();
    expect(card()).toBeNull();
    await until(() => !spellingWords(view).includes("nao"), "the squiggle to go");
  }, 30_000);

  it("adds the word to the dictionary through the store from the card", async () => {
    const store = fakeStore();
    const view = makeView(PT, store);
    await linted(view);
    const dom = await caretCard(view, PT.indexOf("nao") + 1);
    dom.querySelector<HTMLButtonElement>('button[aria-label="Add to dictionary"]')!.click();
    await until(() => store.added.length === 1, "the store call");
    expect(store.added).toEqual(["nao"]);
    await until(() => !spellingWords(view).includes("nao"), "the squiggle to go");
  }, 30_000);

  it("keeps the typed case of a capitalised word", async () => {
    const doc = PT.replace("Eu nao sei", "Nao sei");
    const view = makeView(doc, fakeStore());
    await linted(view);
    const dom = await caretCard(view, doc.indexOf("Nao") + 1);
    expect(dom.querySelector(".ls-spelling-card-word")!.textContent).toBe("Não");
  }, 30_000);

  it("hides on typing and on Escape", async () => {
    const view = makeView(PT, fakeStore());
    await linted(view);
    const at = PT.indexOf("nao") + 1;
    await caretCard(view, at);
    view.dispatch({ changes: { from: at, insert: "x" }, userEvent: "input.type" });
    expect(card()).toBeNull();
    await sleep(500);
    expect(card()).toBeNull();
    view.dispatch({ changes: { from: at, to: at + 1 } });
    await linted(view);
    await caretCard(view, at + 1);
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(card()).toBeNull();
  }, 30_000);

  it("keeps rule diagnostics in the lint tooltip and spelling out of it", () => {
    const rule = { source: "writing", message: "Repeated word" };
    const spelling = { source: "spelling", message: "not in the dictionary" };
    expect(withoutSpelling([spelling, rule])).toEqual([rule]);
  });
});
