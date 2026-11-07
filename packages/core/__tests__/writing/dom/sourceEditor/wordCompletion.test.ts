/** @jest-environment jsdom */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { DictionaryFiles, DictionaryStore } from "../../../../src/writing/proofing/port.js";
import { createProofing, proofingStateOf } from "../../../../src/writing/dom/sourceEditor/proofing.js";
import { createWordCompletion } from "../../../../src/writing/dom/sourceEditor/wordCompletion.js";

function readDictionary(pkg: string): DictionaryFiles | undefined {
  const candidates = [join(process.cwd(), "node_modules", pkg), join(process.cwd(), "packages", "core", "node_modules", pkg)];
  const folder = candidates.find((candidate) => existsSync(join(candidate, "index.aff")));
  if (!folder) return undefined;
  return { aff: new Uint8Array(readFileSync(join(folder, "index.aff"))), dic: new Uint8Array(readFileSync(join(folder, "index.dic"))) };
}

const en = readDictionary("dictionary-en");
const pt = readDictionary("dictionary-pt");
const describeWithDictionaries = en && pt ? describe : describe.skip;

const store: DictionaryStore = {
  list: async () => ["en-US", "pt-BR"],
  read: async (tag) => (tag.startsWith("pt") ? pt! : en!),
  install: async () => undefined,
  userWords: async () => [],
  addUserWord: async () => undefined,
};

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

describeWithDictionaries("word completion", () => {
  it("answers nothing while typing and lists the dictionary's words on explicit completion", async () => {
    const doc = `${PT_PREAMBLE}Um comput\n\\end{document}\n`;
    expect(await complete("latex", doc, "comput", false)).toBeNull();
    const result = await complete("latex", doc, "comput");
    expect(result?.from).toBe(doc.indexOf("comput"));
    expect(labels(result)).toEqual(expect.arrayContaining(["computador", "computadores"]));
  });

  it("lists the correction of a misspelled word first and replaces the word", async () => {
    const doc = `${PT_PREAMBLE}Eu nao sei.\n\\end{document}\n`;
    const result = await complete("latex", doc, "nao");
    expect(labels(result)[0]).toBe("não");
    expect(result?.from).toBe(doc.indexOf("nao"));
    expect(result?.to).toBeUndefined();
    expect(result?.filter).toBe(false);
  });

  it("answers nothing inside a citation, in math or in a command name", async () => {
    const doc = `${PT_PREAMBLE}Veja \\cite{nao} e $nao$ e \\sec aqui.\n\\end{document}\n`;
    expect(await complete("latex", doc, "\\cite{nao")).toBeNull();
    expect(await complete("latex", doc, "$nao")).toBeNull();
    expect(await complete("latex", doc, "\\sec")).toBeNull();
  });

  it("offers a word used earlier in the document before the dictionary's", async () => {
    const doc = `${PT_PREAMBLE}O computabilizador voltou. Depois comput\n\\end{document}\n`;
    const result = labels(await complete("latex", doc, "Depois comput"));
    expect(result.indexOf("computabilizador")).toBe(0);
    expect(result).toContain("computador");
  });

  it("follows the case of the typed prefix", async () => {
    const doc = `${PT_PREAMBLE}Comput\n\\end{document}\n`;
    const result = labels(await complete("latex", doc, "Comput"));
    expect(result).toContain("Computador");
    expect(result).not.toContain("computador");
  });

  it("completes in Typst", async () => {
    const doc = "The word was spelled wrold here.\n";
    const result = await complete("typst", doc, "wrold");
    expect(labels(result)).toContain("world");
    expect(await complete("typst", doc, "wrold", false)).toBeNull();
  });
});
