/** @jest-environment jsdom */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { forceLinting, forEachDiagnostic } from "@codemirror/lint";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ILogger } from "../../../../src/index.js";
import type { HelperProblem } from "../../../../src/helper/index.js";
import type { DictionaryFiles, DictionaryStore } from "../../../../src/writing/proofing/port.js";
import { mountSourceEditor, type SourceEditorDeps } from "../../../../src/writing/dom/sourceEditor/editor.js";
import { applyProblems } from "../../../../src/writing/dom/sourceEditor/editorSupport.js";
import { createProofing, proofingCheckerOf, proofingStateOf, type ProofingSetting } from "../../../../src/writing/dom/sourceEditor/proofing.js";

function dictionaryFolder(pkg: string): string | undefined {
  const candidates = [join(process.cwd(), "node_modules", pkg), join(process.cwd(), "packages", "core", "node_modules", pkg)];
  return candidates.find((folder) => existsSync(join(folder, "index.aff")));
}

function readDictionary(pkg: string): DictionaryFiles | undefined {
  const folder = dictionaryFolder(pkg);
  if (!folder) return undefined;
  return { aff: new Uint8Array(readFileSync(join(folder, "index.aff"))), dic: new Uint8Array(readFileSync(join(folder, "index.dic"))) };
}

const en = readDictionary("dictionary-en");
const pt = readDictionary("dictionary-pt");
const describeWithDictionaries = en && pt ? describe : describe.skip;

interface FakeStore extends DictionaryStore { added: string[]; reads: string[] }

function fakeStore(installed: readonly string[] = ["en-US", "pt-BR"]): FakeStore {
  const added: string[] = [];
  const reads: string[] = [];
  return {
    added, reads,
    list: async () => [...installed],
    read: async (tag) => {
      reads.push(tag);
      if (!installed.includes(tag)) return null;
      return tag.startsWith("pt") ? pt! : en!;
    },
    install: async () => undefined,
    userWords: async () => [...added],
    addUserWord: async (word) => { added.push(word); },
  };
}

const setting = (store: DictionaryStore, enabled = true): ProofingSetting => ({ store, enabled, disable: () => undefined });

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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, what: string, timeout = 15_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${what}`);
    await sleep(10);
  }
}

interface Found { from: number; to: number; source?: string | undefined; severity: string; message: string; apply: Array<{ name: string; run(view: EditorView): void }> }

function found(view: EditorView): Found[] {
  const out: Found[] = [];
  forEachDiagnostic(view.state, (d, from, to) => {
    out.push({
      from, to, source: d.source, severity: d.severity, message: d.message,
      apply: (d.actions ?? []).map((action) => ({ name: action.name, run: (v) => action.apply(v, from, to) })),
    });
  });
  return out.sort((a, b) => a.from - b.from);
}

/** Waits for the checker, then runs the lint now and again after any pending refresh. */
async function linted(view: EditorView): Promise<Found[]> {
  await until(() => proofingStateOf(view.state)?.status === "ready", "the checker");
  for (let round = 0; round < 3; round += 1) {
    forceLinting(view);
    await sleep(30);
  }
  return found(view);
}

const text = (view: EditorView, d: Found): string => view.state.sliceDoc(d.from, d.to);

describeWithDictionaries("proofing", () => {
  const store = fakeStore();

  it("flags a Portuguese misspelling in a babel document but not references or math", async () => {
    const doc = "\\documentclass{article}\n\\usepackage[brazilian]{babel}\n\\begin{document}\nnao sei \\cite{nao} e $nao$ aqui.\n\\end{document}\n";
    const view = makeView(doc, createProofing(setting(store), "latex"));
    const spelling = (await linted(view)).filter((d) => d.source === "spelling");
    expect(spelling.map((d) => text(view, d))).toEqual(["nao"]);
    expect(spelling[0]!.from).toBe(doc.indexOf("nao sei"));
    expect(spelling[0]!.severity).toBe("warning");
    expect(spelling[0]!.message).toBe('"nao" is not in the Portuguese (Brazil) dictionary. Ctrl+Space shows corrections.');
    expect(spelling[0]!.apply.map((a) => a.name)).toEqual(["Add to dictionary", "Ignore in this file"]);
    expect(proofingStateOf(view.state)?.language.tag).toBe("pt-BR");
    expect(proofingCheckerOf(view.state)?.check("não")).toBe(true);
  }, 30_000);

  it("accepts English words, inner capitals in a Portuguese document and still flags misspellings", async () => {
    const doc = "\\documentclass{article}\n\\usepackage[brazilian]{babel}\n\\begin{document}\nOs papers do LabShelf com TikZ e secoes de exemplu.\n\\end{document}\n";
    const view = makeView(doc, createProofing(setting(store), "latex"));
    await linted(view);
    await sleep(500);
    const spelling = (await linted(view)).filter((d) => d.source === "spelling");
    expect(spelling.map((d) => text(view, d))).toEqual(["secoes", "exemplu"]);
  }, 30_000);

  it("flags an English misspelling by default", async () => {
    const view = makeView("\\begin{document}\nThis is teh text.\n\\end{document}\n", createProofing(setting(store), "latex"));
    const spelling = (await linted(view)).filter((d) => d.source === "spelling");
    expect(spelling.map((d) => text(view, d))).toEqual(["teh"]);
  }, 30_000);

  it("adds a word to the dictionary through the store and clears the diagnostic", async () => {
    const own = fakeStore();
    const view = makeView("\\begin{document}\nThe flurbish text.\n\\end{document}\n", createProofing(setting(own), "latex"));
    const [first] = (await linted(view)).filter((d) => d.source === "spelling");
    expect(text(view, first!)).toBe("flurbish");
    first!.apply.find((a) => a.name === "Add to dictionary")!.run(view);
    await until(() => own.added.length === 1, "the store call");
    expect(own.added).toEqual(["flurbish"]);
    await until(() => found(view).every((d) => d.source !== "spelling"), "the diagnostic to go");
  }, 30_000);

  it("ignores a word in one file only", async () => {
    const own = fakeStore();
    const doc = "\\begin{document}\nThe glorbnak text.\n\\end{document}\n";
    const first = makeView(doc, createProofing(setting(own), "latex"));
    const second = makeView(doc, createProofing(setting(own), "latex"));
    const [one] = (await linted(first)).filter((d) => d.source === "spelling");
    expect((await linted(second)).filter((d) => d.source === "spelling")).toHaveLength(1);
    one!.apply.find((a) => a.name === "Ignore in this file")!.run(first);
    await until(() => found(first).every((d) => d.source !== "spelling"), "the diagnostic to go");
    expect(own.added).toEqual([]);
    expect((await linted(second)).filter((d) => d.source === "spelling")).toHaveLength(1);
  }, 30_000);

  it("flags a repeated word with a fix that leaves one", async () => {
    const view = makeView("\\begin{document}\nSee the the figure.\n\\end{document}\n", createProofing(setting(store), "latex"));
    const rules = (await linted(view)).filter((d) => d.source === "writing");
    expect(rules).toHaveLength(1);
    expect(rules[0]!.severity).toBe("info");
    expect(rules[0]!.apply.map((a) => a.name)).toEqual(["Fix"]);
    rules[0]!.apply[0]!.run(view);
    expect(view.state.doc.toString()).toBe("\\begin{document}\nSee the figure.\n\\end{document}\n");
  }, 30_000);

  it("keeps build problems and spelling diagnostics through each other's updates", async () => {
    const view = makeView("\\begin{document}\nThis is teh text.\n\\end{document}\n", createProofing(setting(store), "latex"));
    const problem: HelperProblem = { severity: "error", message: "Undefined control sequence", line: 1 } as HelperProblem;
    await linted(view);
    applyProblems(view, [problem]);
    let now = found(view);
    expect(now.filter((d) => d.severity === "error")).toHaveLength(1);
    expect(now.filter((d) => d.source === "spelling")).toHaveLength(1);
    // A new lint run keeps the problem.
    view.dispatch({ changes: { from: view.state.doc.length, insert: "More teh words.\n" } });
    now = await linted(view);
    forceLinting(view);
    await until(() => found(view).filter((d) => d.source === "spelling").length === 2, "the new lint");
    now = found(view);
    expect(now.filter((d) => d.severity === "error")).toHaveLength(1);
    // Problems set before the checker is ready survive its first lint.
    const early = makeView("\\begin{document}\nThis is teh text.\n\\end{document}\n", createProofing(setting(fakeStore()), "latex"));
    applyProblems(early, [problem]);
    expect(found(early).filter((d) => d.severity === "error")).toHaveLength(1);
    await linted(early);
    await until(() => found(early).some((d) => d.source === "spelling"), "spelling");
    expect(found(early).filter((d) => d.severity === "error")).toHaveLength(1);
    // Clearing the problems keeps the spelling.
    applyProblems(early, []);
    expect(found(early).filter((d) => d.severity === "error")).toHaveLength(0);
    expect(found(early).filter((d) => d.source === "spelling")).toHaveLength(1);
  }, 30_000);

  it("re-detects the language after an edit of the preamble and loads that checker", async () => {
    const own = fakeStore();
    const view = makeView("\\documentclass{article}\n\\begin{document}\nHello there.\n\\end{document}\n", createProofing(setting(own), "latex"));
    await linted(view);
    expect(proofingStateOf(view.state)?.language.tag).toBe("en-US");
    view.dispatch({ changes: { from: view.state.doc.toString().indexOf("\\begin{document}"), insert: "\\usepackage[brazilian]{babel}\n" } });
    await until(() => proofingStateOf(view.state)?.language.tag === "pt-BR" && proofingStateOf(view.state)?.status === "ready", "the Portuguese checker");
    expect(own.reads).toContain("pt-BR");
  }, 30_000);

  it("checks a part that declares no language in its including document's, until the part declares its own", async () => {
    const own = fakeStore();
    const brazilian = { tag: "pt-BR", name: "Portuguese (Brazil)", declared: true };
    const view = makeView("Uma progressão aritmética.\n", createProofing(setting(own), "latex", undefined, async () => brazilian));
    await until(() => proofingStateOf(view.state)?.language.tag === "pt-BR" && proofingStateOf(view.state)?.status === "ready", "the inherited checker");
    expect(own.reads).not.toContain("en-US");
    view.dispatch({ changes: { from: 0, insert: "\\usepackage[english]{babel}\n" } });
    await until(() => proofingStateOf(view.state)?.language.tag === "en-US", "the part's own language");
  }, 30_000);

  it("reports a missing dictionary and an unsupported language without diagnostics", async () => {
    const empty = makeView("\\begin{document}\nThis is teh text.\n\\end{document}\n", createProofing(setting(fakeStore([])), "latex"));
    await until(() => proofingStateOf(empty.state)?.status === "missing", "missing");
    forceLinting(empty);
    await sleep(30);
    expect(found(empty)).toEqual([]);
    const finnish = makeView("\\usepackage[finnish]{babel}\n\\begin{document}\nThis is teh text.\n\\end{document}\n", createProofing(setting(fakeStore()), "latex"));
    expect(proofingStateOf(finnish.state)?.status).toBe("unsupported");
  }, 30_000);

  it("proofs Typst by its declared language", async () => {
    const view = makeView('#set text(lang: "pt", region: "br")\nnao sei\n= Titulo\n#let nao = 1\n', createProofing(setting(store), "typst"));
    const spelling = (await linted(view)).filter((d) => d.source === "spelling");
    expect(spelling.map((d) => text(view, d))).toContain("nao");
    expect(proofingStateOf(view.state)?.language.tag).toBe("pt-BR");
  }, 30_000);

  it("adds nothing when the setting is absent or off", () => {
    const off = makeView("teh teh", createProofing(setting(store, false), "latex"));
    const absent = makeView("teh teh", createProofing(undefined, "latex"));
    expect(proofingStateOf(off.state)).toBeUndefined();
    expect(proofingStateOf(absent.state)).toBeUndefined();
  });
});

describeWithDictionaries("proofing in a mounted editor", () => {
  const logger = { log: async () => undefined, error: async () => undefined, warn: async () => undefined } as unknown as ILogger;

  async function mount(path: string, doc: string, proofing: ProofingSetting | undefined): Promise<EditorView> {
    const host = document.createElement("div");
    document.body.append(host);
    const deps: SourceEditorDeps = {
      projectId: "p", path, logger, ...(proofing ? { proofing } : {}), helper: undefined, papers: async () => [], onDirty: () => undefined,
      files: { list: async () => [path], read: async () => doc, write: async () => undefined },
    };
    await mountSourceEditor(host, deps);
    const view = EditorView.findFromDOM(host)!;
    views.push(view);
    return view;
  }

  it("flags a Typst file without openTab and a LaTeX file", async () => {
    const store = fakeStore();
    const typst = await mount("main.typ", "= Heading\nThis is teh text.\n", setting(store));
    expect((await linted(typst)).filter((d) => d.source === "spelling").map((d) => text(typst, d))).toEqual(["teh"]);
    const latex = await mount("main.tex", "\\begin{document}\nThis is teh text.\n\\end{document}\n", setting(store));
    expect((await linted(latex)).filter((d) => d.source === "spelling").map((d) => text(latex, d))).toEqual(["teh"]);
  }, 30_000);

  it("turns proofing on and off in place from the editor's spelling switch", async () => {
    const store = fakeStore();
    const host = document.createElement("div");
    document.body.append(host);
    const doc = "\\begin{document}\nThis is teh text.\n\\end{document}\n";
    const editor = await mountSourceEditor(host, {
      projectId: "p", path: "main.tex", logger, proofing: setting(store, false), helper: undefined, papers: async () => [], onDirty: () => undefined,
      files: { list: async () => ["main.tex"], read: async () => doc, write: async () => undefined },
    });
    const view = EditorView.findFromDOM(host)!;
    views.push(view);
    expect(editor.spelling?.enabled()).toBe(false);
    editor.spelling!.set(true);
    expect(editor.spelling!.enabled()).toBe(true);
    expect((await linted(view)).filter((d) => d.source === "spelling").map((d) => text(view, d))).toEqual(["teh"]);
    editor.spelling!.set(false);
    expect(proofingStateOf(view.state)).toBeUndefined();
  }, 30_000);

  it("shows nothing when proofing is absent or off", async () => {
    const store = fakeStore();
    for (const proofing of [undefined, setting(store, false)]) {
      for (const [path, doc] of [["main.typ", "This is teh text.\n"], ["main.tex", "\\begin{document}\nThis is teh text.\n\\end{document}\n"]] as const) {
        const view = await mount(path, doc, proofing);
        forceLinting(view);
        await sleep(30);
        expect(proofingStateOf(view.state)).toBeUndefined();
        expect(found(view)).toEqual([]);
      }
    }
    expect(store.reads).toEqual([]);
  }, 30_000);
});
