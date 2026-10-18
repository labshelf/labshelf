/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// The Typst editor talks to Tinymist over the helper's lsp channel: handshake, documents, completion, hover, diagnostics, definition.
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ILogger, PaperRecord } from "@labshelf/core";
import type { HelperLspChannel } from "../../../../src/library-page/helperProject";
import { registerOpenEditor } from "../../../../src/library-page/editor/openEditors";
import { goToDefinition, hoverSource, lspDiagnostics, openTypstDocument, typstCompletion, type TypstDocument } from "../../../../src/library-page/editor/typst";

type Message = Record<string, unknown>;
const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function fakeChannel(results: Record<string, unknown> = {}) {
  const sent: Message[] = [];
  const listeners = new Set<(payload: Message) => void>();
  const emit = (payload: Message): void => { for (const listener of [...listeners]) listener(payload); };
  const channel: HelperLspChannel = {
    async send(payload) {
      sent.push(payload);
      const method = payload["method"] as string;
      if (payload["id"] === undefined || method.startsWith("$/")) return;
      const result = method === "initialize" ? { capabilities: {} } : results[method] ?? null;
      setTimeout(() => emit({ jsonrpc: "2.0", id: payload["id"], result }), 0);
    },
    onMessage(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    onOpen(listener) { listener(); return () => undefined; },
  };
  return { channel, sent, emit, methods: () => sent.map((message) => message["method"]) };
}

let docs: TypstDocument[] = [];
async function open(text: string, results: Record<string, unknown> = {}, projectId = `p${docs.length}`) {
  const fake = fakeChannel(results);
  const diagnostics: unknown[][] = [];
  const doc = openTypstDocument({ projectId, path: "ch 1/main.typ", channel: fake.channel, logger, text: () => text, onDiagnostics: (d) => diagnostics.push([...d]) });
  docs.push(doc);
  await flush(); await flush();
  return { ...fake, doc, diagnostics, projectId };
}
afterEach(() => { for (const doc of docs) doc.close(); docs = []; });

const at = (text: string): CompletionContext => {
  const pos = text.indexOf("|");
  return new CompletionContext(EditorState.create({ doc: text.replace("|", "") }), pos, false);
};
const paper = { id: "1", citeKey: "smith2020", title: "Deep", authors: ["Ann Smith"], year: 2020 } as unknown as PaperRecord;

describe("typst language server session", () => {
  it("initializes, then opens the document once with its labshelf: URI and text", async () => {
    const { sent, methods } = await open("= Intro");
    expect(methods()).toEqual(["initialize", "initialized", "textDocument/didOpen"]);
    expect(sent[2]!["params"]).toEqual({ textDocument: { uri: "labshelf:/ch%201/main.typ", languageId: "typst", version: 0, text: "= Intro" } });
  });

  it("closes the document and answers server requests itself", async () => {
    const { sent, emit, doc, methods } = await open("x");
    emit({ jsonrpc: "2.0", id: 7, method: "window/workDoneProgress/create", params: {} });
    doc.close();
    expect(sent).toContainEqual({ jsonrpc: "2.0", id: 7, result: null });
    expect(methods()).toContain("textDocument/didClose");
  });

  it("maps completion items and puts library @key citations first", async () => {
    const items = [{ label: "smith2020", kind: 18 }, { label: "other", kind: 18, detail: "label" }];
    const { doc, sent } = await open("", { "textDocument/completion": { items } });
    const result = await typstCompletion(doc, async () => [paper])(at("See @smi|"));
    expect(sent.at(-1)!["params"]).toEqual({ textDocument: { uri: "labshelf:/ch%201/main.typ" }, position: { line: 0, character: 8 } });
    expect(result?.from).toBe(5);
    expect(result?.options.map((option) => option.apply)).toEqual(["smith2020", "other"]);
    expect(result?.options[0]!.boost).toBe(1);
  });

  it("maps code completion with snippets and the item's edit range", async () => {
    const items = [{ label: "lorem", kind: 3, detail: "fn", insertTextFormat: 2, textEdit: { range: { start: { line: 1, character: 1 }, end: { line: 1, character: 3 } }, newText: "lorem($1)" } }];
    const { doc } = await open("", { "textDocument/completion": { isIncomplete: false, items } });
    const result = await typstCompletion(doc, async () => [])(at("a\n#lo|"));
    expect(result?.from).toBe(3);
    expect(result?.options[0]).toMatchObject({ label: "lorem", detail: "fn", type: "function" });
    expect(typeof result?.options[0]!.apply).toBe("function");
  });

  it("shows hover contents as plain text", async () => {
    const hover = { contents: { kind: "markdown", value: "```typc\nlet x = 1\n```" }, range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } } };
    const { doc } = await open("", { "textDocument/hover": hover });
    const view = new EditorView({ doc: "#x + 1" });
    const tooltip = await hoverSource(doc)(view, 1, 1);
    expect(tooltip).toMatchObject({ pos: 1, end: 2 });
    expect(tooltip!.create(view).dom.textContent).toBe("let x = 1");
  });

  it("turns publishDiagnostics of its own document into lint diagnostics", async () => {
    const { emit, diagnostics } = await open("ab\ncd");
    const params = { uri: "labshelf:/ch%201/main.typ", diagnostics: [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } }, severity: 2, message: "unused" }] };
    emit({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params });
    emit({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { ...params, uri: "labshelf:/other.typ" } });
    expect(diagnostics).toHaveLength(1);
    expect(lspDiagnostics(EditorState.create({ doc: "ab\ncd" }).doc, diagnostics[0] as never)).toEqual([{ from: 3, to: 5, severity: "warning", message: "unused" }]);
  });

  it("opens the definition's file in a tab of the first group and reveals its line", async () => {
    const target = [{ targetUri: "labshelf:/lib/a%20b.typ", targetRange: { start: { line: 4, character: 0 }, end: { line: 6, character: 0 } }, targetSelectionRange: { start: { line: 5, character: 2 }, end: { line: 5, character: 4 } } }];
    const { doc, projectId } = await open("", { "textDocument/definition": target });
    const openTab = jest.fn();
    const revealed: number[] = [];
    const unregister = registerOpenEditor(projectId, "lib/a b.typ", { revealLine: (line) => revealed.push(line) });
    const view = new EditorView({ doc: "#f()" });
    expect(await goToDefinition(view, doc, 1, { projectId, openTab })).toBe(true);
    expect(openTab).toHaveBeenCalledWith("source", { projectId, path: "lib/a b.typ" }, 0);
    expect(revealed).toEqual([5]);
    unregister();
  });
});
