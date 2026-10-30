/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
import { snippet } from "@codemirror/autocomplete";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { highlightTree } from "@lezer/highlight";
import { AUTO_SAVE_DELAY_MS, type ILogger } from "@labshelf/core";
import { codeHighlight, createEditorExtensions, createWriteScheduler, toProblems, type WriteSchedulerDeps } from "../../../../src/writing/dom/sourceEditor/editor";
import { typstLanguage } from "../../../../src/writing/dom/sourceEditor/typst";

// Build problems become editor diagnostics on their line, clamped to the document, with the hint in the message.
const view = { state: EditorState.create({ doc: "one\ntwo\nthree" }) };

describe("toProblems", () => {
  it("covers the problem's one-based line", () => {
    expect(toProblems([{ severity: "error", message: "Boom", file: "main.tex", line: 2 }], view))
      .toEqual([{ from: 4, to: 7, severity: "error", message: "Boom" }]);
  });

  it("puts a problem without a line on line 1 and clamps a line past the end", () => {
    const result = toProblems([
      { severity: "warning", message: "No line", file: "main.tex" },
      { severity: "info", message: "Far", file: "main.tex", line: 99 },
    ], view);
    expect(result.map((d) => [d.from, d.to, d.severity])).toEqual([[0, 3, "warning"], [8, 13, "info"]]);
  });

  it("appends the hint after the message", () => {
    const [diagnostic] = toProblems([{ severity: "error", message: "Undefined", hint: "Check the spelling", file: "main.tex", line: 1 }], view);
    expect(diagnostic?.message).toBe("Undefined\nCheck the spelling");
  });
});

// Tests that LaTeX and Typst tokens are painted from the code theme's colour roles.
const latex = StreamLanguage.define(stex);
const typst = (typstLanguage as unknown[])[0] as StreamLanguage<unknown>;

// The CSS rule of each class the highlighter puts on `text`, keyed by the highlighted slice.
function paint(language: StreamLanguage<unknown>, text: string): Map<string, string> {
  const rules = codeHighlight.module!.getRules();
  const painted = new Map<string, string>();
  highlightTree(language.parser.parse(text), codeHighlight, (from, to, classes) => {
    const rule = classes.split(" ").map((c) => rules.split("\n").find((r) => r.startsWith(`.${c} `)) ?? "").join(" ");
    painted.set(text.slice(from, to), rule);
  });
  return painted;
}

describe("code highlight", () => {
  it("paints LaTeX commands, environment names, comments and math from their roles", () => {
    const painted = paint(latex, "\\begin{proof} $x$ % done\n");
    expect(painted.get("\\begin")).toContain("--ls-code-command");
    expect(painted.get("proof")).toContain("--ls-code-argument");
    expect(painted.get("x")).toContain("--ls-code-math");
    expect(painted.get("% done")).toContain("--ls-code-comment");
  });

  it("paints Typst math from the math role and its delimiters as keywords", () => {
    const painted = paint(typst, "#let a = $x + 1$\n");
    expect(painted.get("#let")).toContain("--ls-code-keyword");
    expect(painted.get("x + 1")).toContain("--ls-code-math");
    expect(painted.get("$")).toContain("--ls-code-keyword");
  });

  it("paints Typst headings and references", () => {
    const painted = paint(typst, "= Intro\nSee @smith2020.\n");
    expect(painted.get("= Intro")).toContain("--ls-code-heading");
    expect(painted.get("@smith2020.")).toContain("--ls-code-reference");
  });
});

// Pins the shared editor extensions: a snippet's repeated field is typed in all its places at once.
describe("createEditorExtensions", () => {
  it("types the environment name into both \\begin and \\end of the snippet", () => {
    const view = new EditorView({ doc: "\\", extensions: createEditorExtensions([], { onSave: () => undefined }), parent: document.body });
    snippet("\\begin{${1:environment}}\n\t${0}\n\\end{${1:environment}}")(view, null, 0, 1);
    view.dispatch(view.state.replaceSelection("itemize"));
    expect(view.state.doc.toString()).toMatch(/^\\begin{itemize}\n\s*\n\\end{itemize}$/);
    view.destroy();
  });
});

const logger = (): ILogger => ({ log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) });

function setup(write: WriteSchedulerDeps["write"]) {
  const dirty: boolean[] = [];
  const deps: WriteSchedulerDeps = {
    file: "main.tex", text: () => "body", write: jest.fn(write), logger: logger(), onDirty: (value) => dirty.push(value), onSaved: jest.fn(),
  };
  return { deps, dirty, save: createWriteScheduler(deps) };
}

describe("source save scheduler", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("writes once, the autosave delay after the last edit", async () => {
    const { deps, dirty, save } = setup(async () => undefined);
    save.changed();
    jest.advanceTimersByTime(AUTO_SAVE_DELAY_MS - 1);
    save.changed();
    jest.advanceTimersByTime(AUTO_SAVE_DELAY_MS - 1);
    expect(deps.write).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(deps.write).toHaveBeenCalledTimes(1);
    expect(deps.write).toHaveBeenCalledWith("body");
    expect(deps.onSaved).toHaveBeenCalledTimes(1);
    expect(dirty).toEqual([true, false]);
    expect(save.dirty()).toBe(false);
  });

  it("writes pending edits on close without waiting for the delay", async () => {
    const { deps, save } = setup(async () => undefined);
    save.changed();
    await expect(save.flush()).resolves.toBe(true);
    expect(deps.write).toHaveBeenCalledTimes(1);
    await expect(save.flush()).resolves.toBe(true);
    expect(deps.write).toHaveBeenCalledTimes(1);
  });

  it("keeps the file dirty and logs when the write fails", async () => {
    const { deps, dirty, save } = setup(async () => { throw new Error("disk full"); });
    save.changed();
    await expect(save.flush()).resolves.toBe(false);
    expect(save.dirty()).toBe(true);
    expect(dirty).toEqual([true]);
    expect(deps.onSaved).not.toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalledWith("editor.save", expect.any(Error), { action: "writeSource", file: "main.tex" });
  });
});
