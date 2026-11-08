/** @jest-environment jsdom */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import type { DictionaryFiles, DictionaryStore } from "../../../../src/writing/proofing/port.js";
import { createProofing, proofingStateOf } from "../../../../src/writing/dom/sourceEditor/proofing.js";
import { createWordCompletion, createWordGhost } from "../../../../src/writing/dom/sourceEditor/wordCompletion.js";

function readDictionary(pkg: string): DictionaryFiles | undefined {
  const candidates = [join(process.cwd(), "node_modules", pkg), join(process.cwd(), "packages", "core", "node_modules", pkg)];
  const folder = candidates.find((candidate) => existsSync(join(candidate, "index.aff")));
  if (!folder) return undefined;
  return { aff: new Uint8Array(readFileSync(join(folder, "index.aff"))), dic: new Uint8Array(readFileSync(join(folder, "index.dic"))) };
}

const FREQUENCY = join(__dirname, "../../../../src/writing/proofing/frequency");
const withFrequency = (files: DictionaryFiles | undefined, list: string): DictionaryFiles | undefined =>
  files && { ...files, freq: new Uint8Array(readFileSync(join(FREQUENCY, list))) };
const en = withFrequency(readDictionary("dictionary-en"), "en_50k.txt");
const pt = withFrequency(readDictionary("dictionary-pt"), "pt_br_50k.txt");
const describeWithDictionaries = en && pt ? describe : describe.skip;

const store: DictionaryStore = {
  list: async () => ["en-US", "pt-BR"],
  read: async (tag) => (tag.startsWith("pt") ? pt! : en!),
  install: async () => undefined,
  userWords: async () => [],
  addUserWord: async () => undefined,
};

// jsdom has no layout; CodeMirror measures text ranges after an edit.
Range.prototype.getClientRects ??= (() => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] })) as unknown as () => DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const views: EditorView[] = [];

function makeView(doc: string, extension: Extension): EditorView {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: [extension] }) });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = "";
});

async function ready(view: EditorView): Promise<void> {
  const started = Date.now();
  while (proofingStateOf(view.state)?.status !== "ready") {
    if (Date.now() - started > 15_000) throw new Error("Timed out waiting for the checker");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function complete(format: "latex" | "typst", doc: string, marker: string, explicit = true): Promise<CompletionResult | null> {
  const view = makeView(doc, createProofing({ store, enabled: true, disable: () => undefined }, format));
  await ready(view);
  const pos = doc.indexOf(marker) + marker.length;
  return (await createWordCompletion(format)(new CompletionContext(view.state, pos, explicit))) ?? null;
}

const labels = (result: CompletionResult | null): string[] => result?.options.map((option) => option.label) ?? [];

const PT_PREAMBLE = "\\documentclass{article}\n\\usepackage[brazilian]{babel}\n\\begin{document}\n";

describeWithDictionaries("corrections on Ctrl+Space", () => {
  it("lists the corrections of a misspelled word, the best first, replacing the word", async () => {
    const doc = `${PT_PREAMBLE}Eu nao sei.\n\end{document}\n`;
    const result = await complete("latex", doc, "nao");
    expect(labels(result)[0]).toBe("não");
    expect(result?.from).toBe(doc.indexOf("nao"));
    expect(result?.filter).toBe(false);
    expect(labels(await complete("typst", "The word wrold here.\n", "wrold"))).toContain("world");
  });

  it("answers nothing for a word spelled right, while typing, or in a citation, math or a command", async () => {
    const doc = `${PT_PREAMBLE}Um computador \\cite{nao} e $nao$ e \\nao aqui. nao\n\end{document}\n`;
    expect(await complete("latex", doc, "computador")).toBeNull();
    expect(await complete("latex", doc, "aqui. nao", false)).toBeNull();
    for (const marker of ["\\cite{nao", "$nao", "\\nao"]) expect(await complete("latex", doc, marker)).toBeNull();
  });
});

describeWithDictionaries("ghost completion", () => {
  async function editor(doc: string, format: "latex" | "typst" = "latex"): Promise<EditorView> {
    const view = makeView(doc, [createWordGhost(format), keymap.of([indentWithTab]), createProofing({ store, enabled: true, disable: () => undefined }, format)]);
    await ready(view);
    return view;
  }

  /** Types `text` letter by letter after `marker` (at the caret without one), as the keyboard would. */
  function type(view: EditorView, marker: string | null, text: string): void {
    let pos = marker === null ? view.state.selection.main.head : view.state.doc.toString().indexOf(marker) + marker.length;
    view.dispatch({ selection: { anchor: pos } });
    for (const letter of text) {
      view.dispatch({ changes: { from: pos, insert: letter }, selection: { anchor: pos + 1 }, userEvent: "input.type" });
      pos += 1;
    }
  }

  const ghost = (view: EditorView): string | null => view.dom.querySelector(".cm-ls-ghost")?.textContent ?? null;
  const press = (view: EditorView, key: string): boolean => runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");

  it("shows a common word's remaining letters without changing the text, and Tab or ArrowRight inserts them", async () => {
    for (const key of ["Tab", "ArrowRight"]) {
      const doc = `${PT_PREAMBLE}Um \n\end{document}\n`;
      const view = await editor(doc);
      type(view, "Um ", "computa");
      expect(["dor", "ção"]).toContain(ghost(view));
      const shown = ghost(view)!;
      expect(view.state.doc.toString()).toBe(doc.replace("Um ", "Um computa"));
      expect(press(view, key)).toBe(true);
      expect(view.state.doc.toString()).toBe(doc.replace("Um ", `Um computa${shown}`));
      expect(view.state.selection.main.head).toBe(doc.indexOf("Um ") + 3 + "computa".length + shown.length);
      expect(ghost(view)).toBeNull();
    }
  });

  it("prefers the document's words and the word that followed the previous one", async () => {
    const doc = `${PT_PREAMBLE}As redes neurais e as redes neurais. O computabilizador e o computabilizador. \n\end{document}\n`;
    const view = await editor(doc);
    type(view, "computabilizador. ", "redes neu");
    expect(ghost(view)).toBe("rais");
    type(view, null, " comput");
    expect(ghost(view)).toBe("abilizador");
  });

  it("follows the typed case and updates on every letter", async () => {
    const view = await editor("We \n", "typst");
    type(view, "We ", "Becau");
    expect(ghost(view)).toBe("se");
    type(view, "Becau", "s");
    expect(ghost(view)).toBe("e");
  });

  it("shows nothing in commands, citations, math or comments, under three letters or with a selection", async () => {
    const doc = `${PT_PREAMBLE}X \\cite{} e $$ e % \nY \n\end{document}\n`;
    const view = await editor(doc);
    for (const [marker, text] of [["\\cite{", "computa"], ["e $", "computa"], ["X ", "\\computa"], ["% ", "computa"], ["Y ", "co"]] as const) {
      type(view, marker, text);
      expect(ghost(view)).toBeNull();
    }
    type(view, "Y co", "mputa");
    expect(ghost(view)).not.toBeNull();
    view.dispatch({ selection: { anchor: view.state.selection.main.head - 2, head: view.state.selection.main.head } });
    expect(ghost(view)).toBeNull();
  });

  it("hides on Escape until the next letter, and lets Enter, Space and Backspace through", async () => {
    const doc = `${PT_PREAMBLE}Um \n\end{document}\n`;
    const view = await editor(doc);
    type(view, "Um ", "computa");
    expect(press(view, "Escape")).toBe(true);
    expect(ghost(view)).toBeNull();
    expect(press(view, "Escape")).toBe(false);
    type(view, "Um computa", "d");
    expect(ghost(view)).toBe("or");
    expect(press(view, "Enter")).toBe(false);
    expect(press(view, " ")).toBe(false);
    expect(press(view, "Backspace")).toBe(false);
  });

  it("indents with Tab when there is no ghost", async () => {
    const doc = `${PT_PREAMBLE}Um \n\end{document}\n`;
    const view = await editor(doc);
    type(view, "Um ", "co");
    expect(ghost(view)).toBeNull();
    expect(press(view, "Tab")).toBe(true);
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toMatch(/^\s+Um co$/);
  });
});
