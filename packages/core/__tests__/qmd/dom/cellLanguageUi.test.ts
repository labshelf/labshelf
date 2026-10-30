/** @jest-environment jsdom */
/**
 * Tests the language controls of a code cell in the note editor: the picker that rewrites the fence, Run and Mod-Enter carrying the
 * cell language, Restart, the picker and Restart in the output action line of a cell with a result, the missing-language text of the
 * run status row, and the input rules that create Mathematica and R cells.
 *
 * Assumptions about the DOM, since the spec fixes no selectors for the new controls: the picker is a button inside the cell header or
 * the output action line whose text is the language name or whose aria-label mentions "language"; its menu entries are radio menu
 * items (role menuitemradio) labelled Python, Mathematica and R; Restart is a button whose text or aria-label starts with "Restart".
 */
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { Node as PmNode } from "prosemirror-model";
import { mountQmdEditor, type QmdEditorHandle } from "../../../src/qmd/dom/qmdEditor";
import { createCellRunGroup } from "../../../src/qmd/dom/cellRunStatus";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { codeFenceEnter, qmdInputRules } from "../../../src/qmd/dom/qmdInputRules";
import { editRequestPlugin } from "../../../src/qmd/dom/qmdCommands";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { docToBody } from "../../../src/qmd/editor";
import { deriveCodeHash, formatOutput } from "../../../src/qmd/item/cellOutput";
import { para, until } from "../../support/nodeViewHarness";

// jsdom has no layout; CodeMirror measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const LABELS = ["Python", "Mathematica", "R"];

let mounted: QmdEditorHandle[] = [];
afterEach(() => {
  for (const handle of mounted) { try { handle.destroy(); } catch { /* already destroyed */ } }
  mounted = [];
  document.body.innerHTML = "";
});

interface Hooks { runs: Array<[string, string, string]>; restarts: string[]; changes: string[] }

function setup(body: string, opts: { restart?: boolean } = {}): { root: HTMLElement; handle: QmdEditorHandle } & Hooks {
  const root = document.createElement("div");
  document.body.append(root);
  const hooks: Hooks = { runs: [], restarts: [], changes: [] };
  const handle = mountQmdEditor(root, {
    body,
    onChange: (next) => hooks.changes.push(next),
    onRunCell: (label: string, code: string, language: string) => hooks.runs.push([label, code, language]),
    ...(opts.restart === false ? {} : { onRestartCell: (language: string) => hooks.restarts.push(language) }),
  } as Parameters<typeof mountQmdEditor>[1]);
  mounted.push(handle);
  return { root, handle, ...hooks };
}

const words = (el: Element): string => `${el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""}`;
const buttonsIn = (scope: Element): HTMLButtonElement[] => [...scope.querySelectorAll<HTMLButtonElement>("button")];
const pickerIn = (scope: Element): HTMLElement | undefined =>
  buttonsIn(scope).find((b) => /language/i.test(b.getAttribute("aria-label") ?? "")) ??
  buttonsIn(scope).find((b) => LABELS.includes((b.textContent ?? "").trim()));
const restartIn = (scope: Element): HTMLButtonElement | undefined =>
  buttonsIn(scope).find((b) => /^\s*restart/i.test(b.textContent ?? "") || /^\s*restart/i.test(b.getAttribute("aria-label") ?? ""));
const cellOf = (root: HTMLElement): HTMLElement => root.querySelector<HTMLElement>(".qmd-cell")!;
const outputLine = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>(".qmd-output-actions");
const menuItems = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
const menuItem = (label: string): HTMLElement | undefined => menuItems().find((el) => (el.textContent ?? "").trim() === label);

/** Opens the language picker found in `scope` and chooses `label`. */
function pick(scope: Element, label: string): void {
  const picker = pickerIn(scope);
  if (!picker) throw new Error("no language picker found");
  picker.click();
  const entry = menuItem(label);
  if (!entry) throw new Error(`no menu entry ${label}`);
  entry.click();
}

const PY = "```{python}\nprint(1)\n```\n";

async function withOutput(lang: string, code: string): Promise<string> {
  const output = formatOutput({ cell: "bound", source: await deriveCodeHash(code), engine: lang, ran: "2026-10-30T09:15:03.000Z", content: "result-text-42\n" });
  return `\`\`\`{${lang}}\n#| label: bound\n${code}\`\`\`\n\n${output}`;
}

describe("language picker", () => {
  it("4.1a the picker of a cell lists Python, Mathematica and R and marks the current language", () => {
    const { root } = setup(PY);
    pickerIn(cellOf(root))!.click();
    expect(menuItems().map((el) => (el.textContent ?? "").trim())).toEqual(LABELS);
    expect(menuItems().map((el) => el.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
  });

  it("4.1a picking R on a Python cell serialises the fence as ```{r}", () => {
    const { root, handle, changes } = setup(PY);
    pick(cellOf(root), "R");
    handle.flush();
    expect(changes.length).toBeGreaterThan(0);
    const body = changes[changes.length - 1]!;
    expect(body).toMatch(/^```\{r\}\n/);
    expect(body).not.toContain("{python}");
    expect(body).toContain("print(1)\n");
  });

  it("4.1a picking Mathematica serialises the fence as ```{mathematica}", () => {
    const { root, handle, changes } = setup(PY);
    pick(cellOf(root), "Mathematica");
    handle.flush();
    expect(changes[changes.length - 1]).toMatch(/^```\{mathematica\}\n/);
  });

  it("4.1a picking Python on an R cell writes the fence back as ```{python}", () => {
    const { root, handle, changes } = setup("```{r}\nx <- 1\n```\n");
    pick(cellOf(root), "Python");
    handle.flush();
    expect(changes[changes.length - 1]).toMatch(/^```\{python\}\n/);
  });

  it("4.1a the header of an R cell shows R and marks it as the current choice", () => {
    const { root } = setup("```{r}\nx <- 1\n```\n");
    expect(cellOf(root).textContent).toContain("R");
    pickerIn(cellOf(root))!.click();
    expect(menuItems().map((el) => el.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
  });

  it("4.1a a cell whose language is not a cell language shows it as text, with no picker and no Run", () => {
    const { root } = setup("```{julia}\nx = 1\n```\n");
    const cell = cellOf(root);
    expect(cell.textContent).toContain("julia");
    expect(pickerIn(cell)).toBeUndefined();
    expect(buttonsIn(cell).some((b) => /^\s*run\b/i.test(words(b)))).toBe(false);
  });
});

describe("Run, Mod-Enter and Restart", () => {
  const modEnter = (root: HTMLElement): void => {
    const content = root.querySelector<HTMLElement>(".qmd-cell-code .cm-content")!;
    content.focus();
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
  };

  it("4.1b Run calls onRunCell with the label, the code and python for a Python cell", () => {
    const { root, runs } = setup(PY);
    root.querySelector<HTMLButtonElement>(".qmd-cell-run")!.click();
    expect(runs).toEqual([["cell-1", "print(1)\n", "python"]]);
  });

  it("4.1b Run calls onRunCell with mathematica for a Mathematica cell", () => {
    const { root, runs } = setup("```{mathematica}\n1 + 1\n```\n");
    root.querySelector<HTMLButtonElement>(".qmd-cell-run")!.click();
    expect(runs).toEqual([["cell-1", "1 + 1\n", "mathematica"]]);
  });

  it("4.1b Run calls onRunCell with r for an R cell", () => {
    const { root, runs } = setup("```{r}\nx <- 1\n```\n");
    root.querySelector<HTMLButtonElement>(".qmd-cell-run")!.click();
    expect(runs).toEqual([["cell-1", "x <- 1\n", "r"]]);
  });

  it("4.1b Run uses the language picked last, not the one the note was opened with", () => {
    const { root, runs } = setup(PY);
    pick(cellOf(root), "R");
    root.querySelector<HTMLButtonElement>(".qmd-cell-run")!.click();
    expect(runs).toEqual([["cell-1", "print(1)\n", "r"]]);
  });

  it("4.1b Mod-Enter in a Mathematica cell calls onRunCell with mathematica", () => {
    const { root, runs } = setup("```{mathematica}\n1 + 1\n```\n");
    modEnter(root);
    expect(runs).toEqual([["cell-1", "1 + 1\n", "mathematica"]]);
  });

  it("4.1b Mod-Enter in an R cell calls onRunCell with r", () => {
    const { root, runs } = setup("```{r}\nx <- 1\n```\n");
    modEnter(root);
    expect(runs).toEqual([["cell-1", "x <- 1\n", "r"]]);
  });

  it("4.1b Mod-Enter in a Python cell calls onRunCell with python", () => {
    const { root, runs } = setup(PY);
    modEnter(root);
    expect(runs).toEqual([["cell-1", "print(1)\n", "python"]]);
  });

  it("4.1b the code editor of a Mathematica cell is labelled Mathematica code and of an R cell R code", () => {
    const math = setup("```{mathematica}\n1 + 1\n```\n");
    expect(math.root.querySelector('.qmd-cell-code [aria-label="Mathematica code"]')).not.toBeNull();
    const r = setup("```{r}\nx <- 1\n```\n");
    expect(r.root.querySelector('.qmd-cell-code [aria-label="R code"]')).not.toBeNull();
  });

  it("4.1b Restart calls onRestartCell with the language of its cell", () => {
    const { root, restarts } = setup("```{mathematica}\n1 + 1\n```\n");
    const restart = restartIn(cellOf(root))!;
    expect(restart).toBeDefined();
    expect(words(restart)).toMatch(/Mathematica/);
    restart.click();
    expect(restarts).toEqual(["mathematica"]);
  });

  it("4.1b Restart on a Python cell is labelled Restart Python and calls onRestartCell with python", () => {
    const { root, restarts, runs } = setup(PY);
    const restart = restartIn(cellOf(root))!;
    expect(words(restart)).toMatch(/Restart Python/);
    restart.click();
    expect(restarts).toEqual(["python"]);
    expect(runs).toEqual([]);
  });

  it("4.1b Restart shows only when the host gives onRestartCell", () => {
    const { root } = setup(PY, { restart: false });
    expect(restartIn(cellOf(root))).toBeUndefined();
  });
});

describe("a cell with a result", () => {
  it("4.1e keeps its language picker and Restart in the output action line", async () => {
    const { root } = setup(await withOutput("python", "print(1)\n"));
    await until(() => outputLine(root) !== null);
    const line = outputLine(root)!;
    expect(pickerIn(line)).toBeDefined();
    expect(words(restartIn(line)!)).toMatch(/Restart Python/);
  });

  it("4.1e Restart in the output action line calls onRestartCell with the cell language", async () => {
    const { root, restarts } = setup(await withOutput("r", "x <- 1\n"));
    await until(() => outputLine(root) !== null);
    restartIn(outputLine(root)!)!.click();
    expect(restarts).toEqual(["r"]);
  });

  it("4.1e the picker in the output action line rewrites the fence", async () => {
    const { root, handle, changes } = setup(await withOutput("python", "print(1)\n"));
    await until(() => outputLine(root) !== null);
    pick(outputLine(root)!, "Mathematica");
    handle.flush();
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[changes.length - 1]).toMatch(/^```\{mathematica\}\n/);
  });

  it("4.1e the output action line still has Run again, which carries the cell language", async () => {
    const { root, runs } = setup(await withOutput("mathematica", "1 + 1\n"));
    await until(() => outputLine(root) !== null);
    outputLine(root)!.querySelector<HTMLButtonElement>(".qmd-output-run")!.click();
    expect(runs).toEqual([["bound", "1 + 1\n", "mathematica"]]);
  });

  it("4.1e the output action line has no Restart when the host gives no onRestartCell", async () => {
    const { root } = setup(await withOutput("python", "print(1)\n"), { restart: false });
    await until(() => outputLine(root) !== null);
    expect(restartIn(outputLine(root)!)).toBeUndefined();
  });
});

describe("run status row for a missing language", () => {
  const buttonLabels = (el: Element): string[] => buttonsIn(el).map((b) => b.textContent ?? "");

  /** Runs one cell of `language` through a group and answers `missing`; @returns the status row. */
  function missing(language: string, withInstall: boolean): HTMLElement {
    const editorEl = document.createElement("div");
    document.body.append(editorEl);
    let request = "";
    const group = createCellRunGroup({ onCancel: () => undefined, ...(withInstall ? { onInstallPython: () => undefined } : {}) });
    const run = group.attach("note", editorEl, (_label: string, _code: string, id: string) => { request = id; }) as unknown as (label: string, code: string, language: string) => void;
    run("a", "x\n", language);
    group.show(request, "missing");
    return editorEl.nextElementSibling as HTMLElement;
  }

  it("4.1c a missing mathematica result shows the Mathematica text without an install button", () => {
    const row = missing("mathematica", true);
    expect(row.hidden).toBe(false);
    expect(row.textContent).toContain("Mathematica cells need Wolfram Engine or Mathematica with wolframscript.");
    expect(buttonLabels(row)).toEqual([]);
  });

  it("4.1c a missing r result shows the R text without an install button", () => {
    const row = missing("r", true);
    expect(row.textContent).toContain("R cells need R (Rscript).");
    expect(buttonLabels(row)).toEqual([]);
  });

  it("4.1c a missing python result keeps the Install Python prompt", () => {
    const row = missing("python", true);
    expect(row.textContent).toContain("Python for calculations is not installed.");
    expect(buttonLabels(row)).toEqual(["Install Python"]);
  });

  it("4.1c the Mathematica text does not mention Python", () => {
    expect(missing("mathematica", false).textContent).not.toMatch(/Python/);
  });
});

describe("input rules for Mathematica and R cells", () => {
  const views: EditorView[] = [];
  afterEach(() => { while (views.length > 0) views.pop()!.destroy(); });

  function mountDoc(doc: PmNode): EditorView {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [qmdInputRules(), editRequestPlugin()] }),
      nodeViews: { code_cell: createCodeCellView(() => undefined) },
      handleScrollToSelection: () => true,
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    views.push(view);
    return view;
  }

  /** Types one character at a time through the input rules, as the browser's text input would. */
  function type(view: EditorView, typed: string): void {
    for (const char of typed) {
      const { from, to } = view.state.selection;
      const handled = view.someProp("handleTextInput", (handle) => handle(view, from, to, char, () => view.state.tr));
      if (!handled) view.dispatch(view.state.tr.insertText(char, from, to));
    }
  }

  const empty = (): PmNode => s.node("doc", null, [para()]);

  it("4.1d ```{mathematica} plus space creates a mathematica cell", () => {
    const view = mountDoc(empty());
    type(view, "```{mathematica} ");
    const cell = view.state.doc.firstChild!;
    expect(cell.type.name).toBe("code_cell");
    expect(cell.attrs.lang).toBe("mathematica");
    expect(docToBody(view.state.doc)).toMatch(/^```\{mathematica\}\n```\n/);
  });

  it("4.1d ```{r} plus space creates an r cell", () => {
    const view = mountDoc(empty());
    type(view, "```{r} ");
    const cell = view.state.doc.firstChild!;
    expect(cell.type.name).toBe("code_cell");
    expect(cell.attrs.lang).toBe("r");
    expect(docToBody(view.state.doc)).toMatch(/^```\{r\}\n```\n/);
  });

  it("4.1d ```wolfram plus space creates a mathematica cell", () => {
    const view = mountDoc(empty());
    type(view, "```wolfram ");
    const cell = view.state.doc.firstChild!;
    expect(cell.type.name).toBe("code_cell");
    expect(cell.attrs.lang).toBe("mathematica");
  });

  it("4.1d ```{r} followed by Enter creates an r cell", () => {
    const view = mountDoc(empty());
    type(view, "```{r}");
    expect(codeFenceEnter(view.state, view.dispatch, view)).toBe(true);
    expect(view.state.doc.firstChild!.attrs.lang).toBe("r");
  });

  it("4.1d ```{python} plus space still creates a python cell", () => {
    const view = mountDoc(empty());
    type(view, "```{python} ");
    expect(view.state.doc.firstChild!.attrs.lang).toBe("python");
  });
});
