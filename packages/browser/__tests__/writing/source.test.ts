/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
import * as Y from "yjs";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type ILogger, type ProjectEntry, createImageSnippet, createTableSnippet, readShareIndexDocFiles } from "@labshelf/core";
import type { PageShare } from "../../src/collab";
import { mountSourceEditor } from "../../src/writing/editor";
import { deriveCodeMirrorTemplate, readSourceFileMode } from "../../src/writing/source";

// Pins read-only access until a shared file has a text index entry.
const entry = { kind: "ready", folder: "projects/demo", settings: { id: "demo", shared: "s1" } } as unknown as ProjectEntry;

function sharing(state: "observer" | undefined): Pick<PageShare, "liveShare" | "shares"> {
  return {
    liveShare: async () => undefined,
    shares: { state: () => (state ? { kind: state } : undefined), name: () => "Ada" },
  } as unknown as Pick<PageShare, "liveShare" | "shares">;
}

describe("readSourceFileMode", () => {
  it("opens the file as observing the share when another tab of the profile runs it", async () => {
    expect(await readSourceFileMode(sharing("observer"), entry, "main.tex", logger, false)).toEqual({ kind: "observing", shareId: "s1" });
  });

  it("opens the file unresolved when no tab runs the share", async () => {
    expect(await readSourceFileMode(sharing(undefined), entry, "main.tex", logger, false)).toEqual({ kind: "unresolved" });
  });

  it("keeps an orphan document read-only until its index entry arrives", async () => {
    const index = new Y.Doc();
    const doc = new Y.Doc();
    const openDoc = jest.fn(() => doc);
    const connected = {
      ...sharing(undefined), liveShare: async () => ({ session: { index, openDoc }, presence: {} }),
    } as unknown as Pick<PageShare, "liveShare" | "shares">;
    expect(await readSourceFileMode(connected, entry, "main.tex", logger, false)).toEqual({ kind: "unresolved" });
    expect(openDoc).not.toHaveBeenCalled();
    readShareIndexDocFiles(index).set("main.tex", { kind: "text" });
    expect((await readSourceFileMode(connected, entry, "main.tex", logger, true)).kind).toBe("shared");
    expect(openDoc).toHaveBeenCalledWith("main.tex");
    doc.destroy(); index.destroy();
  });
});

// Insertions and bold or italic wrapping apply to every selection of the source editor in one transaction.
const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const ready = { state: "ready" as const, helperVersion: "1", tex: { source: "none" as const, complete: false }, host: "helper" as const };

async function mount(text: string, path = "main.tex") {
  const files = { list: async () => [path], read: async () => text, write: jest.fn(async () => undefined) };
  const helper = { status: () => ready, edit: jest.fn(async () => undefined), save: jest.fn(async () => undefined) };
  const host = document.createElement("div");
  const editor = await mountSourceEditor(host, { projectId: "p", path, files, papers: async () => [], helper, logger, onDirty: () => undefined });
  const view = EditorView.findFromDOM(host)!;
  const select = (...ranges: [number, number][]): void => view.dispatch({ selection: EditorSelection.create(ranges.map(([anchor, head]) => EditorSelection.range(anchor, head))) });
  const selected = (): [number, number][] => view.state.selection.ranges.map((range) => [range.from, range.to]);
  return { editor, view, select, selected, doc: () => view.state.doc.toString() };
}

describe("insertText", () => {
  it("replaces every selection and leaves a cursor after each", async () => {
    const { editor, select, selected, doc } = await mount("a b c");
    select([0, 1], [2, 3], [4, 4]);
    editor.insertText("X");
    expect(doc()).toBe("X X Xc");
    expect(selected()).toEqual([[1, 1], [3, 3], [5, 5]]);
    await editor.dispose();
  });
});

describe("wrap", () => {
  it("wraps each selected range and keeps it selected", async () => {
    const { editor, select, selected, doc } = await mount("ab cd");
    select([0, 2], [3, 5]);
    editor.wrap("bold");
    expect(doc()).toBe("\\textbf{ab} \\textbf{cd}");
    expect(selected()).toEqual([[0, 11], [12, 23]]);
    await editor.dispose();
  });

  it("removes markup that is already there", async () => {
    const { editor, select, selected, doc } = await mount("\\textbf{ab} \\textbf{cd}");
    select([0, 11], [12, 23]);
    editor.wrap("bold");
    expect(doc()).toBe("ab cd");
    expect(selected()).toEqual([[0, 2], [3, 5]]);
    await editor.dispose();
  });

  it("puts an empty pair around an empty selection and the cursor inside it", async () => {
    const { editor, select, selected, doc } = await mount("x");
    select([1, 1]);
    editor.wrap("italic");
    expect(doc()).toBe("x\\emph{}");
    expect(selected()).toEqual([[7, 7]]);
    await editor.dispose();
  });

  it("wraps in Typst markers for a .typ file", async () => {
    const { editor, select, doc } = await mount("ab", "main.typ");
    select([0, 2]);
    editor.wrap("bold");
    expect(doc()).toBe("*ab*");
    await editor.dispose();
  });

  it("wraps on Mod-b", async () => {
    const { editor, view, select, doc } = await mount("ab");
    select([0, 2]);
    const event = new KeyboardEvent("keydown", { key: "b", code: "KeyB", keyCode: 66, ctrlKey: true, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    expect(doc()).toBe("\\textbf{ab}");
    expect(event.defaultPrevented).toBe(true);
    await editor.dispose();
  });
});

describe("insertSnippet", () => {
  it("inserts the table at the cursor with its literal backslashes and braces", async () => {
    const { editor, select, doc } = await mount("before\nafter");
    select([7, 7]);
    editor.insertSnippet(createTableSnippet("latex", { columns: 2, rows: 1 }));
    expect(doc()).toContain("before\n\\begin{table}[h]\n  \\centering\n  \\begin{tabular}{|c|c|}");
    expect(doc()).toContain("\\caption{Caption}");
    expect(doc()).toContain("\\\\\n");
    expect(doc().endsWith("\\end{table}\nafter")).toBe(true);
    await editor.dispose();
  });
});

describe("deriveCodeMirrorTemplate", () => {
  it("unescapes a backslash and a dollar sign", () => {
    expect(deriveCodeMirrorTemplate("a\\\\b")).toBe("a\\b");
    expect(deriveCodeMirrorTemplate("cost \\$5")).toBe("cost $5");
  });

  it("turns the final cursor and bare tab stops into CodeMirror fields", () => {
    expect(deriveCodeMirrorTemplate("x$0")).toBe("x${0}");
    expect(deriveCodeMirrorTemplate("$1 and $2")).toBe("${1} and ${2}");
  });

  it("keeps a placeholder field", () => {
    expect(deriveCodeMirrorTemplate("${1:Caption}")).toBe("${1:Caption}");
  });

  it("doubles a literal backslash that sits before a brace, which CodeMirror would read as an escape", () => {
    expect(deriveCodeMirrorTemplate("\\\\{x}")).toBe("\\\\{x}");
    expect(deriveCodeMirrorTemplate("\\}")).toBe("}");
  });

  it("converts a LaTeX image figure", () => {
    const converted = deriveCodeMirrorTemplate(createImageSnippet("latex", "images/a.png"));
    expect(converted).toContain("\\begin{figure}[h]");
    expect(converted).toContain("\\includegraphics[width=0.8\\linewidth]{images/a.png}");
    expect(converted).toContain("\\caption{${1:Caption}}");
    expect(converted.endsWith("${0}")).toBe(true);
  });

  it("converts a Typst table, keeping the cell stops", () => {
    const converted = deriveCodeMirrorTemplate(createTableSnippet("typst", { columns: 2, rows: 1 }));
    expect(converted).toContain("columns: 2,");
    expect(converted).toContain("[${1}], [${2}],");
    expect(converted).toContain("caption: [${3:Caption}],");
    expect(converted.endsWith("${0}")).toBe(true);
  });
});
