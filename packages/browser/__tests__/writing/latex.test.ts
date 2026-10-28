import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import type { PaperRecord } from "@labshelf/core";
import {
  createCitationCompletion,
  createCitationOption,
  closeEnvironmentOnEnter,
  findLatexCommandCompletion,
  createReferenceCompletion,
} from "../../src/writing/latex";

const at = (text: string): CompletionContext => {
  const pos = text.indexOf("|");
  return new CompletionContext(EditorState.create({ doc: text.replace("|", "") }), pos, true);
};
const labels = (result: CompletionResult | null): string[] => result?.options.map((option) => option.label) ?? [];

describe("latex command completion", () => {
  it("offers catalog commands from the backslash", () => {
    const result = findLatexCommandCompletion(at("x \\sec|"));
    expect(result?.from).toBe(2);
    expect(labels(result)).toEqual(expect.arrayContaining(["\\section", "\\usepackage"]));
  });

  it("offers environments inside \\begin{ and replaces an auto-closed brace", () => {
    const result = findLatexCommandCompletion(at("\\begin{ite|}"));
    expect(result).toMatchObject({ from: 7, to: 11 });
    expect(labels(result)).toEqual(expect.arrayContaining(["itemize", "equation"]));
  });

  it("offers nothing in plain text or after an escaped backslash", () => {
    expect(findLatexCommandCompletion(at("plain|"))).toBeNull();
    expect(findLatexCommandCompletion(at("\\\\|"))).toBeNull();
  });
});

describe("reference completion", () => {
  const source = createReferenceCompletion(() => [{ name: "fig:a", file: "main.tex" }, { name: "eq:b", file: "ch1.tex" }]);
  it.each(["\\ref{|", "\\eqref{|", "\\cref{fig:a, |"])("offers project labels in %s", (text) => {
    const result = source(at(text)) as CompletionResult;
    expect(result.from).toBe(text.indexOf("|"));
    expect(result.options).toEqual([
      { label: "fig:a", detail: "main.tex", type: "variable" }, { label: "eq:b", detail: "ch1.tex", type: "variable" },
    ]);
  });
  it("offers nothing outside a reference", () => { expect(source(at("\\label{|"))).toBeNull(); });
});

describe("citation completion", () => {
  const paper = { citeKey: "smith2020", title: "Deep things", authors: ["Ann Smith", "Bo Li"], year: 2020 } as PaperRecord;
  it("shapes a paper like the VS Code item: key and year shown, title as detail, filtered by key title authors", () => {
    expect(createCitationOption(paper)).toMatchObject({
      label: "smith2020 Deep things Ann Smith, Bo Li", displayLabel: "smith2020 2020", detail: "Deep things",
      apply: "smith2020", info: "Ann Smith, Bo Li 2020",
    });
  });
  it("completes the key after the last comma of a \\cite", async () => {
    const result = await createCitationCompletion(async () => [paper])(at("\\cite{a, smi|"));
    expect(result?.from).toBe(9);
    expect(result?.options.map((option) => option.apply)).toEqual(["smith2020"]);
  });
  it("offers nothing outside a cite command", async () => {
    expect(await createCitationCompletion(async () => [paper])(at("smi|"))).toBeNull();
  });
});

describe("\\begin auto-close on Enter", () => {
  const enter = (text: string): { doc: string; cursor: number } | null => {
    let state = EditorState.create({ doc: text.replace("|", ""), selection: { anchor: text.indexOf("|") } });
    const handled = closeEnvironmentOnEnter({ state, dispatch: (tr) => { state = tr.state; } });
    return handled ? { doc: state.doc.toString(), cursor: state.selection.main.head } : null;
  };
  it("inserts the matching \\end and leaves the cursor on the indented body line", () => {
    expect(enter("  \\begin{itemize}|")).toEqual({ doc: "  \\begin{itemize}\n    \n  \\end{itemize}", cursor: 22 });
  });
  it("closes an environment written with arguments", () => {
    expect(enter("\\begin{tabular}{ll}|")?.doc).toBe("\\begin{tabular}{ll}\n  \n\\end{tabular}");
  });
  it("falls through when the environment is already closed or text follows the cursor", () => {
    expect(enter("\\begin{x}|\n\\end{x}")).toBeNull();
    expect(enter("\\begin{x}| tail")).toBeNull();
  });
});
