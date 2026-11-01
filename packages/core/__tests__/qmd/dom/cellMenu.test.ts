/** @jest-environment jsdom */
/**
 * Tests the ⋯ cell menu (spec 4.1, plan D10 and D12) through cellMenuEntries, deleteCell and the .qmd-cell-menu button of a code cell view: the entries and their order,
 * Run above / Run below with the item-local key, Collapse cell, Change language, and Delete asking first and removing the cell with its outputs as one undo step.
 *
 * The view is built here with the node views, foldPlugin and history, as foldPlugin.test.ts does; askDialog is mocked on the widgets module so no dialog opens.
 * Written as if the file sat at packages/core/__tests__/qmd/dom/cellMenu.test.ts.
 */
import type { Node as PmNode } from "prosemirror-model";
import { EditorState, type Transaction } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { EditorView, type NodeViewConstructor } from "prosemirror-view";
import { bodyToDoc, docToBody } from "../../../src/qmd/editor";
import { CELL_LANGUAGES, cellLanguageLabel } from "../../../src/qmd/compute";
import { deriveCodeHash, formatOutput } from "../../../src/qmd/item/cellOutput";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { createOutputView } from "../../../src/qmd/dom/outputView";
import { foldPlugin, foldStateOf } from "../../../src/qmd/dom/foldPlugin";
import { cellMenuEntries, deleteCell } from "../../../src/qmd/dom/cellMenu";
import { mountNoteBar, type NoteActions } from "../../../src/qmd/dom/noteBar";
import { closeMenu, type MenuEntry, type MenuItem } from "../../../src/ui/dom/widgets/menu";
import { mountQmdEditor, type QmdEditorHandle } from "../../../src/qmd/dom/qmdEditor";
import { askDialog } from "../../../src/ui/dom/widgets/dialog";
// Side effect: the TextEncoder shim the code hash needs in jsdom.
import "../../support/nodeViewHarness";

jest.mock("../../../src/ui/dom/widgets/dialog", () => ({ ...jest.requireActual("../../../src/ui/dom/widgets/dialog"), askDialog: jest.fn() }));
const ask = askDialog as jest.Mock;

// The 4th parameter (noteActions) and MenuItem.title are added by this spec; typed loosely so the file compiles against the stubs too.
const cellViewWith = createCodeCellView as unknown as (onRun?: unknown, onRestart?: unknown, loadPlotly?: unknown, noteActions?: NoteActions) => NodeViewConstructor;
const titleOf = (item: MenuItem): string | undefined => (item as MenuItem & { title?: string }).title;
type EditorExtra = Partial<Parameters<typeof mountQmdEditor>[1]> & { noteActions?: NoteActions };

// jsdom has no layout; CodeMirror measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const RAN = "2026-10-22T09:15:03.000Z";
const views: EditorView[] = [];
afterEach(() => {
  closeMenu();
  while (views.length > 0) views.pop()!.destroy();
  document.body.innerHTML = "";
  ask.mockReset();
});

const cellText = (lang: string, label: string | null, code: string): string => `\`\`\`{${lang}}\n${label ? `#| label: ${label}\n` : ""}${code}\n\`\`\`\n`;
const outputText = async (label: string, code: string, content: string): Promise<string> =>
  formatOutput({ cell: label, source: await deriveCodeHash(code + "\n"), engine: "python-3.12", ran: RAN, content });

/** first (with two outputs), a paragraph, an unlabelled cell without output, a paragraph. */
async function noteBody(): Promise<string> {
  return [
    cellText("python", "first", "x = 1"), await outputText("first", "x = 1", "one\n"), await outputText("first", "x = 1", "again\n"),
    "between\n",
    cellText("python", null, "y = 2"),
    "tail\n",
  ].join("\n");
}

/** The actions a host passes: the note bar's own, wrapped so a test sees the scopes asked for. The bar has no editors, so a scope runs no cell. */
function barActions(canRun: boolean): NoteActions & { runScope: jest.Mock } {
  const bar = mountNoteBar(document.body.appendChild(document.createElement("div")), { editors: () => [], flush: () => undefined, restart: async () => undefined, canRun: () => canRun });
  const real = bar.actionsFor("n");
  return { runScope: jest.fn((scope: Parameters<NoteActions["runScope"]>[0]) => real.runScope(scope)), canRun: () => real.canRun() };
}

interface Fixture { view: EditorView; dispatched: Transaction[]; actions: NoteActions & { runScope: jest.Mock } }

function mountBody(body: string, canRun = true): Fixture {
  const dispatched: Transaction[] = [];
  const actions = barActions(canRun);
  const host = document.createElement("div");
  document.body.append(host);
  const view: EditorView = new EditorView(host, {
    state: EditorState.create({ doc: bodyToDoc(body), plugins: [foldPlugin(), history()] }),
    nodeViews: {
      code_cell: cellViewWith(undefined, undefined, undefined, actions),
      output: createOutputView(async () => ({ renderMathSvg: () => "<svg></svg>" })),
    },
    dispatchTransaction(tr) {
      dispatched.push(tr);
      view.updateState(view.state.apply(tr));
    },
  });
  views.push(view);
  return { view, dispatched, actions };
}

interface Found { node: PmNode; pos: number }
function blocks(view: EditorView): Found[] {
  const out: Found[] = [];
  view.state.doc.forEach((node, pos) => out.push({ node, pos }));
  return out;
}
const cellsOf = (view: EditorView): Found[] => blocks(view).filter((b) => b.node.type.name === "code_cell");
const typesOf = (view: EditorView): string[] => blocks(view).map((b) => b.node.type.name);
const body = (view: EditorView): string => docToBody(view.state.doc);

const menuButton = (view: EditorView, cell: Found): HTMLButtonElement => (view.nodeDOM(cell.pos) as HTMLElement).querySelector<HTMLButtonElement>("button.qmd-cell-menu")!;
const openMenu = (view: EditorView, cell: Found): void => menuButton(view, cell).click();
const labels = (): string[] =>
  [...document.querySelectorAll<HTMLElement>(".ls-menu > *")].map((child) => (child.getAttribute("role") === "separator" ? "---" : child.querySelector(".ls-menu-label")!.textContent!));
const menuItem = (label: string): HTMLButtonElement => {
  const hit = [...document.querySelectorAll<HTMLButtonElement>(".ls-menu-item")].find((item) => item.querySelector(".ls-menu-label")!.textContent === label);
  if (!hit) throw new Error(`no menu item ${label}`);
  return hit;
};
const entry = (entries: MenuEntry[], label: string): MenuItem => {
  const hit = entries.find((candidate): candidate is MenuItem => candidate !== "separator" && candidate.label === label);
  if (!hit) throw new Error(`no entry ${label}`);
  return hit;
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("the cell menu button", () => {
  it("4.1b ends the cell line of an editable cell with a .qmd-cell-menu button labelled 'Cell actions'", async () => {
    const { view } = mountBody(await noteBody());
    const button = menuButton(view, cellsOf(view)[0]!);
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe("Cell actions");
    expect(button.textContent).toContain("⋯");
  });

  it("4.1b opens the menu with the D10 entries, labels exactly, in order", async () => {
    const { view } = mountBody(await noteBody());
    openMenu(view, cellsOf(view)[0]!);
    expect(labels()).toEqual(["Run above", "Run below", "---", "Collapse cell", "Duplicate", "Change language", "Move up", "Move down", "---", "Delete"]);
  });

  it("4.1b marks Delete as a danger entry", async () => {
    const { view } = mountBody(await noteBody());
    openMenu(view, cellsOf(view)[0]!);
    expect(menuItem("Delete").classList.contains("danger")).toBe(true);
  });
});

describe("cellMenuEntries", () => {
  it("4.1b lists Run above, Run below, a separator, Collapse cell, Duplicate, Change language, Move up, Move down, a separator and Delete", async () => {
    const { view, actions } = mountBody(await noteBody());
    const entries = cellMenuEntries(view, () => cellsOf(view)[0]!.pos, actions);
    expect(entries.map((e) => (e === "separator" ? "---" : e.label))).toEqual(["Run above", "Run below", "---", "Collapse cell", "Duplicate", "Change language", "Move up", "Move down", "---", "Delete"]);
    expect(entry(entries, "Delete").danger).toBe(true);
  });

  it("4.1b Run below runs the below scope from the cell's label", async () => {
    const { view, actions } = mountBody(await noteBody());
    entry(cellMenuEntries(view, () => cellsOf(view)[0]!.pos, actions), "Run below").onSelect();
    expect(actions.runScope).toHaveBeenCalledWith({ kind: "below", cell: "first" });
  });

  it("4.1b Run above runs the above scope, and an unlabelled cell is keyed cell-<n> among all code cells", async () => {
    const { view, actions } = mountBody(await noteBody());
    entry(cellMenuEntries(view, () => cellsOf(view)[1]!.pos, actions), "Run above").onSelect();
    expect(actions.runScope).toHaveBeenCalledWith({ kind: "above", cell: "cell-2" });
  });

  it("4.1b disables Run above and Run below with the 'No runner for this note' title without noteActions", async () => {
    const { view } = mountBody(await noteBody());
    const entries = cellMenuEntries(view, () => cellsOf(view)[0]!.pos, undefined);
    for (const label of ["Run above", "Run below"]) {
      expect(entry(entries, label).disabled).toBe(true);
      expect(titleOf(entry(entries, label))).toBe("No runner for this note");
    }
    for (const label of ["Collapse cell", "Change language", "Delete"]) expect(entry(entries, label).disabled).toBeFalsy();
  });

  it("4.1b disables Run above and Run below when the actions cannot run", async () => {
    const { view, actions } = mountBody(await noteBody(), false);
    const entries = cellMenuEntries(view, () => cellsOf(view)[0]!.pos, actions);
    for (const label of ["Run above", "Run below"]) {
      expect(entry(entries, label).disabled).toBe(true);
      expect(titleOf(entry(entries, label))).toBe("No runner for this note");
    }
  });

  it("4.1b Collapse cell collapses the cell under its local key", async () => {
    const { view, actions } = mountBody(await noteBody());
    entry(cellMenuEntries(view, () => cellsOf(view)[0]!.pos, actions), "Collapse cell").onSelect();
    expect([...foldStateOf(view.state).cells]).toEqual(["first"]);
  });
});

describe("through the menu button", () => {
  it("4.1b Run below from the opened menu runs the below scope of that cell", async () => {
    const { view, actions } = mountBody(await noteBody());
    openMenu(view, cellsOf(view)[1]!);
    menuItem("Run below").click();
    expect(actions.runScope).toHaveBeenCalledWith({ kind: "below", cell: "cell-2" });
    expect(document.querySelector(".ls-menu")).toBeNull();
  });

  it("4.1b Change language opens a radio list of the cell languages with the current one checked", async () => {
    const { view } = mountBody(await noteBody());
    openMenu(view, cellsOf(view)[0]!);
    menuItem("Change language").click();
    expect(labels()).toEqual(CELL_LANGUAGES.map(cellLanguageLabel));
    const radios = [...document.querySelectorAll(".ls-menu-item")];
    expect(radios.map((item) => item.getAttribute("role"))).toEqual(CELL_LANGUAGES.map(() => "menuitemradio"));
    expect(radios.map((item) => item.getAttribute("aria-checked"))).toEqual(CELL_LANGUAGES.map((language) => String(language === "python")));
  });

  it("4.1b choosing a language rewrites the cell's fence", async () => {
    const { view } = mountBody(await noteBody());
    openMenu(view, cellsOf(view)[0]!);
    menuItem("Change language").click();
    menuItem(cellLanguageLabel("r")).click();
    expect(body(view)).toMatch(/```\{r\}\n#\| label: first/);
  });
});

describe("Delete", () => {
  it("4.1b asks 'Delete cell' before removing anything, and removes nothing until the answer", async () => {
    let answer!: (value: boolean) => void;
    ask.mockReturnValue(new Promise<boolean>((resolve) => { answer = resolve; }));
    const { view } = mountBody(await noteBody());
    const before = body(view);
    openMenu(view, cellsOf(view)[0]!);
    menuItem("Delete").click();
    await tick();
    expect(ask).toHaveBeenCalledWith("Delete cell", "Delete this cell and its outputs?", "Delete", true);
    expect(body(view)).toBe(before);
    answer(false);
    await tick();
    expect(body(view)).toBe(before);
  });

  it("4.1b leaves the note unchanged when the dialog is declined", async () => {
    ask.mockResolvedValue(false);
    const { view } = mountBody(await noteBody());
    const before = body(view);
    openMenu(view, cellsOf(view)[0]!);
    menuItem("Delete").click();
    await tick();
    expect(body(view)).toBe(before);
  });

  it("4.1b removes the cell and its consecutive outputs when the dialog is accepted, keeping the rest", async () => {
    ask.mockResolvedValue(true);
    const { view } = mountBody(await noteBody());
    expect(typesOf(view)).toEqual(["code_cell", "output", "output", "paragraph", "code_cell", "paragraph"]);
    openMenu(view, cellsOf(view)[0]!);
    menuItem("Delete").click();
    await tick();
    await tick();
    expect(typesOf(view)).toEqual(["paragraph", "code_cell", "paragraph"]);
    expect(body(view)).not.toContain("x = 1");
    expect(body(view)).toContain("y = 2");
    expect(body(view)).toContain("between");
  });
});

describe("deleteCell", () => {
  it("4.1b removes the code cell at pos and its output siblings in one transaction", async () => {
    const { view, dispatched } = mountBody(await noteBody());
    deleteCell(view, cellsOf(view)[0]!.pos);
    expect(dispatched).toHaveLength(1);
    expect(typesOf(view)).toEqual(["paragraph", "code_cell", "paragraph"]);
  });

  it("4.1b removes only the cell when it has no output", async () => {
    const { view } = mountBody(await noteBody());
    deleteCell(view, cellsOf(view)[1]!.pos);
    expect(typesOf(view)).toEqual(["code_cell", "output", "output", "paragraph", "paragraph"]);
  });

  it("4.1b is one undo step", async () => {
    const { view } = mountBody(await noteBody());
    const before = body(view);
    deleteCell(view, cellsOf(view)[0]!.pos);
    expect(body(view)).not.toBe(before);
    undo(view.state, view.dispatch.bind(view));
    expect(body(view)).toBe(before);
  });
});

describe("A8 cell menu", () => {
  it("A8 a cell offers the ⋯ cell menu with Run above, Run below and Delete", async () => {
    const { view } = mountBody(await noteBody());
    openMenu(view, cellsOf(view)[0]!);
    expect(labels()).toEqual(expect.arrayContaining(["Run above", "Run below", "Delete"]));
  });
});

// --- cells in mountQmdEditor
const EDITOR_BODY = "# Top\n\n## Alpha\n\n```{python}\nx = 1\n```\n\n## Beta\n\nplain text\n";

let mountedEditors: QmdEditorHandle[] = [];
afterEach(() => {
  for (const handle of mountedEditors) { try { handle.destroy(); } catch { /* already destroyed */ } }
  mountedEditors = [];
});

/** The actions a host passes: the note bar's own, wrapped so a test sees the scopes asked for. The bar has no editors, so a scope runs no cell. */
function editorActions(canRun = true): NoteActions & { runScope: jest.Mock } {
  const bar = mountNoteBar(document.body.appendChild(document.createElement("div")), { editors: () => [], flush: () => undefined, restart: async () => undefined, canRun: () => canRun });
  const real = bar.actionsFor("n");
  return { runScope: jest.fn((scope: Parameters<NoteActions["runScope"]>[0]) => real.runScope(scope)), canRun: () => real.canRun() };
}

function editorSetup(extra: EditorExtra = {}): HTMLElement {
  editorActions();
  const root = document.createElement("div");
  document.body.append(root);
  mountedEditors.push(mountQmdEditor(root, { body: EDITOR_BODY, onChange: () => undefined, ...extra }));
  return root;
}


describe("cells in the editor", () => {
  it("4.1b gives an editable cell a ⋯ cell menu button", () => {
    const root = editorSetup({ noteActions: editorActions() });
    const button = root.querySelector<HTMLButtonElement>(".qmd-cell .qmd-cell-menu");
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-label")).toBe("Cell actions");
  });

  it("4.1b gives a cell no cell menu button in a read-only note", () => {
    const root = editorSetup({ noteActions: editorActions(), readOnly: true });
    expect(root.querySelector(".qmd-cell")).not.toBeNull();
    expect(root.querySelector(".qmd-cell-menu")).toBeNull();
  });

  it("4.1b Run below in the cell menu reaches noteActions with the cell's local key", () => {
    const actions = editorActions();
    const root = editorSetup({ noteActions: actions });
    root.querySelector<HTMLButtonElement>(".qmd-cell-menu")!.click();
    const item = [...document.querySelectorAll<HTMLButtonElement>(".ls-menu-item")].find((candidate) => candidate.textContent!.includes("Run below"))!;
    item.click();
    expect(actions.runScope).toHaveBeenCalledWith({ kind: "below", cell: "cell-1" });
  });

  it("4.1b disables Run above and Run below in the cell menu without noteActions", () => {
    const root = editorSetup();
    root.querySelector<HTMLButtonElement>(".qmd-cell-menu")!.click();
    const items = [...document.querySelectorAll<HTMLButtonElement>(".ls-menu-item")].filter((candidate) => /Run (above|below)/.test(candidate.textContent!));
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.disabled).toBe(true);
      expect(item.getAttribute("title")).toBe("No runner for this note");
    }
  });
});

