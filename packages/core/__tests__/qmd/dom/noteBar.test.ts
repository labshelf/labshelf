/** @jest-environment jsdom */
/**
 * Tests the note bar (spec 4.1, plan D10 and D12) through mountNoteBar, and the heading Run section action and the editor-level note actions that the bar feeds (foldPlugin options, mountQmdEditor noteActions, Mod-Shift-Enter, shortcut titles): the Run all button and the note actions menu, the run coordinator behind them (cells of
 * every editor in order, item-prefixed keys, the cross-item cascade relay), the fold entries, the disabled state without a runner, and actionsFor.
 *
 * The editors are fakes: a partial QmdEditorHandle whose notebook(itemId) lists fake cells that log their runs. Written as if the file sat at
 * packages/core/__tests__/qmd/dom/noteBar.test.ts; imports only the seams of src/qmd/dom/noteBar.ts and existing code.
 */
import { mountNoteBar, type NoteBarEditor } from "../../../src/qmd/dom/noteBar";
import { shortcutLabel } from "../../../src/qmd/dom/qmdCommands";
import { closeMenu } from "../../../src/ui/dom/widgets/menu";
import type { QmdEditorHandle } from "../../../src/qmd/dom/qmdEditor";
import type { CellRunEnd, NotebookCell } from "../../../src/qmd/noteRuns";
import { EditorState, type Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { bodyToDoc } from "../../../src/qmd/editor";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { foldPlugin } from "../../../src/qmd/dom/foldPlugin";
import { notebookCells } from "../../../src/qmd/dom/notebookCells";
import { mountQmdEditor } from "../../../src/qmd/dom/qmdEditor";
import type { NoteActions } from "../../../src/qmd/dom/noteBar";

// foldPlugin options and QmdEditorOptions.noteActions are added by this spec; typed loosely so the file compiles against the stubs too.
const foldWith = foldPlugin as unknown as (options?: { runSection?(sectionKey: string): void; canRun?(): boolean }) => Plugin;
type EditorExtra = Partial<Parameters<typeof mountQmdEditor>[1]> & { noteActions?: NoteActions };

// jsdom has no layout; CodeMirror measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const until = async (check: () => boolean, ms = 2000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

interface CellSpec { local: string; language?: string; sections?: string[]; end?: CellRunEnd }
interface FakeEditor extends NoteBarEditor {
  fake: { [K in keyof QmdEditorHandle]: jest.Mock };
  reading: boolean;
}

/** Everything the fake cells did, in call order: "run:<key>". */
let log: string[] = [];

function fakeEditor(itemId: string, specs: CellSpec[], reading = false): FakeEditor {
  const editor = { itemId, reading } as FakeEditor;
  const fake = {
    setBody: jest.fn(),
    flush: jest.fn(),
    focus: jest.fn(),
    destroy: jest.fn(),
    sections: jest.fn(() => []),
    notebook: jest.fn((id?: string): readonly NotebookCell[] =>
      specs.map((spec): NotebookCell => {
        const key = `${id ?? ""}#${spec.local}`;
        return {
          key,
          itemId: id ?? "",
          language: spec.language ?? "python",
          sectionKeys: spec.sections ?? [],
          run: async () => { log.push(`run:${key}`); return spec.end ?? "ok"; },
          cancel: () => undefined,
          setQueue: () => undefined,
        };
      })),
    markUpstreamChange: jest.fn(),
    collapseAll: jest.fn(),
    expandAll: jest.fn(),
    setReading: jest.fn((value: boolean) => { editor.reading = value; }),
    foldState: jest.fn(() => ({ cells: new Set<string>(), sections: new Set<string>(), reading: editor.reading })),
    revealProblem: jest.fn(() => false),
    outline: jest.fn(() => []),
    reveal: jest.fn(),
    outlineOpen: jest.fn(() => false),
    setOutlineOpen: jest.fn(),
  };
  (editor as { handle: QmdEditorHandle }).handle = fake as unknown as QmdEditorHandle;
  editor.fake = fake;
  return editor;
}

interface Setup { host: HTMLElement; bar: ReturnType<typeof mountNoteBar>; a: FakeEditor; b: FakeEditor; flush: jest.Mock; restart: jest.Mock; can: { value: boolean } }

function setup(opts: { a?: CellSpec[]; b?: CellSpec[]; canRun?: boolean; readingA?: boolean; readingB?: boolean; menuRoot?: ShadowRoot } = {}): Setup {
  const host = document.createElement("div");
  document.body.append(host);
  const a = fakeEditor("a", opts.a ?? [{ local: "c1" }, { local: "c2" }], opts.readingA ?? false);
  const b = fakeEditor("b", opts.b ?? [{ local: "c1" }, { local: "c2" }], opts.readingB ?? false);
  const flush = jest.fn(async () => { log.push("flush"); });
  const restart = jest.fn(async (language: string) => { log.push(`restart:${language}`); });
  const can = { value: opts.canRun ?? true };
  const bar = mountNoteBar(host, { editors: () => [a, b], flush, restart, canRun: () => can.value, ...(opts.menuRoot ? { menuRoot: opts.menuRoot } : {}) });
  return { host, bar, a, b, flush, restart, can };
}

beforeEach(() => { log = []; });
afterEach(() => {
  closeMenu();
  document.body.innerHTML = "";
});

const runAllButton = (host: HTMLElement): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.qmd-note-bar button[aria-label="Run all"]')!;
const moreButton = (host: HTMLElement): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.qmd-note-bar button[aria-label="Note actions"]')!;
const menuOf = (root: ParentNode = document): HTMLElement | null => root.querySelector<HTMLElement>(".ls-menu");
const menuLabels = (root: ParentNode = document): string[] =>
  [...menuOf(root)!.children].map((child) => (child.getAttribute("role") === "separator" ? "---" : child.querySelector(".ls-menu-label")!.textContent!));
const menuItem = (label: string, root: ParentNode = document): HTMLButtonElement => {
  const hit = [...menuOf(root)!.querySelectorAll<HTMLButtonElement>(".ls-menu-item")].find((item) => item.querySelector(".ls-menu-label")!.textContent === label);
  if (!hit) throw new Error(`no menu item ${label}`);
  return hit;
};

describe("mountNoteBar mounting", () => {
  it("4.1a appends a .qmd-note-bar to the host with a Run all button and a Note actions button", () => {
    const { host } = setup();
    expect(host.querySelectorAll(":scope > .qmd-note-bar")).toHaveLength(1);
    expect(runAllButton(host)).not.toBeNull();
    expect(moreButton(host)).not.toBeNull();
  });

  it("4.1a titles the Run all button with the Mod-Shift-Enter shortcut label", () => {
    const { host } = setup();
    expect(runAllButton(host).getAttribute("title")).toBe(`Run all (${shortcutLabel("Mod-Shift-Enter")})`);
  });

  it("4.1a calls no handle method while mounting but the outline flag", () => {
    const { a, b } = setup();
    for (const editor of [a, b]) for (const [name, mock] of Object.entries(editor.fake)) if (name !== "outlineOpen") expect(mock).not.toHaveBeenCalled();
  });

  it("4.1a destroy removes the note bar element", () => {
    const { host, bar } = setup();
    bar.destroy();
    expect(host.querySelector(".qmd-note-bar")).toBeNull();
  });
});

describe("Run all", () => {
  it("4.1a runs every cell of both editors in order, flushing first", async () => {
    const { host, flush } = setup();
    runAllButton(host).click();
    await until(() => log.length >= 5);
    expect(log).toEqual(["flush", "run:a#c1", "run:a#c2", "run:b#c1", "run:b#c2"]);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("4.1a runs the same cells from the menu's Run all entry", async () => {
    const { host } = setup();
    moreButton(host).click();
    menuItem("Run all").click();
    await until(() => log.length >= 5);
    expect(log).toEqual(["flush", "run:a#c1", "run:a#c2", "run:b#c1", "run:b#c2"]);
  });

  it("4.1a asks each editor for its cells under the editor's item id", async () => {
    const { bar, a, b } = setup();
    await bar.runs.run({ kind: "all" });
    expect(a.fake.notebook).toHaveBeenCalledWith("a");
    expect(b.fake.notebook).toHaveBeenCalledWith("b");
  });

  it("4.1a Restart and run all restarts each language once, then runs every cell", async () => {
    const { host, restart } = setup({ a: [{ local: "c1", language: "python" }, { local: "c2", language: "r" }], b: [{ local: "c1", language: "python" }] });
    moreButton(host).click();
    menuItem("Restart and run all").click();
    await until(() => log.filter((line) => line.startsWith("run:")).length >= 3);
    expect(restart.mock.calls.map((call) => call[0]).sort()).toEqual(["python", "r"]);
    expect(log.slice(0, 3).sort()).toEqual(["flush", "restart:python", "restart:r"]);
    expect(log.slice(3)).toEqual(["run:a#c1", "run:a#c2", "run:b#c1"]);
  });

  it("4.1a exposes the coordinator as runs, which refuses a second run while one is in flight", async () => {
    const { bar } = setup();
    const first = bar.runs.run({ kind: "all" });
    expect(bar.runs.running).toBe(true);
    expect(bar.runs.run({ kind: "all" })).toBe(first);
    await first;
    expect(bar.runs.running).toBe(false);
  });
});

describe("cross-item cascade relay", () => {
  it("4.1a marks the upstream change on every editor after the cell's editor, never on its own", async () => {
    const { bar, a, b } = setup({ a: [{ local: "c1", language: "r" }], b: [{ local: "c1", language: "python" }] });
    const before = Date.now();
    await bar.runs.run({ kind: "all" });
    expect(b.fake.markUpstreamChange).toHaveBeenCalledTimes(1);
    expect(b.fake.markUpstreamChange).toHaveBeenCalledWith("r", expect.any(Number));
    expect(b.fake.markUpstreamChange.mock.calls[0]![1]).toBeGreaterThanOrEqual(before);
    expect(a.fake.markUpstreamChange).not.toHaveBeenCalled();
  });

  it("4.1a relays after an error end too, which also stops the run", async () => {
    const { bar, b } = setup({ a: [{ local: "c1", end: "error" }, { local: "c2" }] });
    await bar.runs.run({ kind: "all" });
    expect(log).toEqual(["flush", "run:a#c1"]);
    expect(b.fake.markUpstreamChange).toHaveBeenCalledTimes(1);
  });

  it("4.1a does not relay after a cancelled end", async () => {
    const { bar, b } = setup({ a: [{ local: "c1", end: "cancelled" }] });
    await bar.runs.run({ kind: "all" });
    expect(b.fake.markUpstreamChange).not.toHaveBeenCalled();
  });
});

describe("the note actions menu", () => {
  it("4.1a lists the D10 entries, labels exactly, in order", () => {
    const { host } = setup();
    moreButton(host).click();
    expect(menuLabels()).toEqual(["Run all", "Restart and run all", "---", "Collapse all", "Expand all", "Reading mode", "Next problem", "Previous problem", "Outline"]);
  });

  it("4.1a gives the Run all entry the Mod-Shift-Enter hint", () => {
    const { host } = setup();
    moreButton(host).click();
    expect(menuItem("Run all").querySelector(".hint")!.textContent).toBe(shortcutLabel("Mod-Shift-Enter"));
  });

  it("4.1a opens the menu in menuRoot when one is given", () => {
    const shadowHost = document.createElement("div");
    document.body.append(shadowHost);
    const root = shadowHost.attachShadow({ mode: "open" });
    const { host } = setup({ menuRoot: root });
    moreButton(host).click();
    expect(menuOf(root)).not.toBeNull();
    expect(menuOf(document.body)).toBeNull();
  });

  it("4.1a Collapse all collapses every editor", () => {
    const { host, a, b } = setup();
    moreButton(host).click();
    menuItem("Collapse all").click();
    expect(a.fake.collapseAll).toHaveBeenCalledTimes(1);
    expect(b.fake.collapseAll).toHaveBeenCalledTimes(1);
  });

  it("4.1a Expand all expands every editor", () => {
    const { host, a, b } = setup();
    moreButton(host).click();
    menuItem("Expand all").click();
    expect(a.fake.expandAll).toHaveBeenCalledTimes(1);
    expect(b.fake.expandAll).toHaveBeenCalledTimes(1);
  });

  it("4.1a Reading mode is unchecked when no editor is reading, and selecting turns it on in every editor", () => {
    const { host, a, b } = setup();
    moreButton(host).click();
    expect(menuItem("Reading mode").getAttribute("aria-checked")).toBe("false");
    menuItem("Reading mode").click();
    expect(a.fake.setReading).toHaveBeenCalledWith(true);
    expect(b.fake.setReading).toHaveBeenCalledWith(true);
  });

  it("4.1a Reading mode is checked when every editor is reading, and selecting turns it off in every editor", () => {
    const { host, a, b } = setup({ readingA: true, readingB: true });
    moreButton(host).click();
    expect(menuItem("Reading mode").getAttribute("aria-checked")).toBe("true");
    menuItem("Reading mode").click();
    expect(a.fake.setReading).toHaveBeenCalledWith(false);
    expect(b.fake.setReading).toHaveBeenCalledWith(false);
  });

  it("4.1a Reading mode is unchecked when only some editors are reading, and selecting turns it on everywhere", () => {
    const { host, a, b } = setup({ readingA: true, readingB: false });
    moreButton(host).click();
    expect(menuItem("Reading mode").getAttribute("aria-checked")).toBe("false");
    menuItem("Reading mode").click();
    expect(a.fake.setReading).toHaveBeenCalledWith(true);
    expect(b.fake.setReading).toHaveBeenCalledWith(true);
  });
});

describe("without a runner", () => {
  it("4.1a disables the Run all button with the 'No runner for this note' title", () => {
    const { host } = setup({ canRun: false });
    expect(runAllButton(host).disabled).toBe(true);
    expect(runAllButton(host).getAttribute("title")).toBe("No runner for this note");
  });

  it("4.1a disables the run entries of the menu with that title and keeps the fold entries enabled", () => {
    const { host } = setup({ canRun: false });
    moreButton(host).click();
    for (const label of ["Run all", "Restart and run all"]) {
      expect(menuItem(label).disabled).toBe(true);
      expect(menuItem(label).getAttribute("title")).toBe("No runner for this note");
    }
    for (const label of ["Collapse all", "Expand all", "Reading mode"]) expect(menuItem(label).disabled).toBe(false);
  });

  it("4.1a clicking the disabled Run all button runs nothing", async () => {
    const { host } = setup({ canRun: false });
    runAllButton(host).click();
    await tick();
    expect(log).toEqual([]);
  });

  it("4.1a refresh() re-reads canRun for the Run all button", () => {
    const { host, bar, can } = setup({ canRun: false });
    can.value = true;
    bar.refresh();
    expect(runAllButton(host).disabled).toBe(false);
    can.value = false;
    bar.refresh();
    expect(runAllButton(host).disabled).toBe(true);
  });
});

describe("actionsFor", () => {
  it("4.1a canRun is the note bar's canRun", () => {
    const { bar, can } = setup();
    expect(bar.actionsFor("a").canRun()).toBe(true);
    can.value = false;
    expect(bar.actionsFor("a").canRun()).toBe(false);
  });

  it("4.1a prefixes an item-local cell key with the item id for a below scope", async () => {
    const { bar } = setup();
    bar.actionsFor("b").runScope({ kind: "below", cell: "c2" });
    await until(() => log.includes("run:b#c2"));
    await tick();
    expect(log).toEqual(["flush", "run:b#c2"]);
  });

  it("4.1a prefixes the key for an above scope and reaches cells of earlier items", async () => {
    const { bar } = setup();
    bar.actionsFor("b").runScope({ kind: "above", cell: "c2" });
    await until(() => log.includes("run:b#c1"));
    await tick();
    expect(log).toEqual(["flush", "run:a#c1", "run:a#c2", "run:b#c1"]);
  });

  it("4.1a runs a section of one item only, since section keys are prefixed with the item id", async () => {
    const { bar } = setup({
      a: [{ local: "c1", sections: ["1:Intro:0"] }, { local: "c2", sections: ["1:Other:0"] }],
      b: [{ local: "c1", sections: ["1:Intro:0"] }, { local: "c2" }],
    });
    bar.actionsFor("b").runScope({ kind: "section", section: "1:Intro:0" });
    await until(() => log.includes("run:b#c1"));
    await tick();
    expect(log).toEqual(["flush", "run:b#c1"]);
  });
});

describe("A8 note bar", () => {
  it("A8 the note bar offers Run all with its shortcut in the title and a menu of the note actions", () => {
    const { host } = setup();
    expect(runAllButton(host).getAttribute("title")).toContain(shortcutLabel("Mod-Shift-Enter"));
    moreButton(host).click();
    expect(menuLabels()).toContain("Restart and run all");
  });
});

// --- Run section on headings

const views: EditorView[] = [];
afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
});

const cellText = (label: string, code: string): string => `\`\`\`{python}\n#| label: ${label}\n${code}\n\`\`\`\n`;
const BODY = [
  "# Top\n", cellText("t1", "t = 1"),
  "## Alpha\n", cellText("a1", "a = 1"), cellText("a2", "a = 2"),
  "## Beta\n", cellText("b1", "b = 1"),
  "## Alpha\n", cellText("a3", "a = 3"),
].join("\n");

/** Every view sits under a note bar, as in a host; the bar is mounted first. */
function mountView(body: string, plugin: Plugin): EditorView {
  mountNoteBar(document.body.appendChild(document.createElement("div")), { editors: () => [], flush: () => undefined, restart: async () => undefined, canRun: () => true });
  const host = document.createElement("div");
  document.body.append(host);
  const view = new EditorView(host, { state: EditorState.create({ doc: bodyToDoc(body), plugins: [plugin] }), nodeViews: { code_cell: createCodeCellView() } });
  views.push(view);
  return view;
}

/** The heading elements of the view, in document order. */
function headings(view: EditorView): HTMLElement[] {
  const out: HTMLElement[] = [];
  view.state.doc.forEach((node, pos) => { if (node.type.name === "heading") out.push(view.nodeDOM(pos) as HTMLElement); });
  return out;
}
const runButton = (heading: HTMLElement): HTMLButtonElement | null => heading.querySelector<HTMLButtonElement>("button.qmd-section-run");

describe("foldPlugin with runSection", () => {
  it("4.1c gives every heading a Run section button beside its chevron", () => {
    const view = mountView(BODY, foldWith({ runSection: () => undefined, canRun: () => true }));
    const all = headings(view);
    expect(all).toHaveLength(4);
    for (const heading of all) {
      expect(runButton(heading)).not.toBeNull();
      expect(heading.querySelector(".qmd-section-toggle")).not.toBeNull();
    }
  });

  it("4.1c labels the button 'Run section' with that title", () => {
    const view = mountView(BODY, foldWith({ runSection: () => undefined, canRun: () => true }));
    const button = runButton(headings(view)[0]!)!;
    expect(button.getAttribute("aria-label")).toBe("Run section");
    expect(button.getAttribute("title")).toBe("Run section");
    expect(button.disabled).toBe(false);
  });

  it("4.1c calls runSection with the section key of the clicked heading, counting repeated headings", () => {
    const runSection = jest.fn();
    const view = mountView(BODY, foldWith({ runSection, canRun: () => true }));
    const all = headings(view);
    runButton(all[0]!)!.click();
    runButton(all[1]!)!.click();
    runButton(all[2]!)!.click();
    runButton(all[3]!)!.click();
    expect(runSection.mock.calls.map((call) => call[0])).toEqual(["1:Top:0", "2:Alpha:0", "2:Beta:0", "2:Alpha:1"]);
  });

  it("4.1c disables the button with the 'No runner for this note' title when canRun is false, and a click runs nothing", () => {
    const runSection = jest.fn();
    const view = mountView(BODY, foldWith({ runSection, canRun: () => false }));
    const button = runButton(headings(view)[1]!)!;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("No runner for this note");
    button.click();
    expect(runSection).not.toHaveBeenCalled();
  });

  it("4.1c adds no Run section button without options, and the chevron stays", () => {
    const view = mountView(BODY, foldPlugin());
    for (const heading of headings(view)) {
      expect(runButton(heading)).toBeNull();
      expect(heading.querySelector(".qmd-section-toggle")).not.toBeNull();
    }
  });
});

describe("Run section through the note bar", () => {
  function sectionSetup(): { view: EditorView; log: string[] } {
    const log: string[] = [];
    let view!: EditorView;
    const handle = {
      notebook: (itemId?: string) => notebookCells(view, itemId ?? "").map((cell) => ({ ...cell, run: async () => { log.push(cell.key); return "ok" as const; } })),
      markUpstreamChange: () => undefined,
      outlineOpen: () => false,
    } as unknown as QmdEditorHandle;
    const bar = mountNoteBar(document.body.appendChild(document.createElement("div")), { editors: () => [{ itemId: "n", handle }], flush: () => undefined, restart: async () => undefined, canRun: () => true });
    const actions = bar.actionsFor("n");
    view = mountView(BODY, foldWith({ runSection: (key: string) => actions.runScope({ kind: "section", section: key }), canRun: () => actions.canRun() }));
    return { view, log };
  }

  it("4.1c Run section on a heading runs only the cells of that section", async () => {
    const { view, log } = sectionSetup();
    runButton(headings(view)[1]!)!.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(log).toEqual(["n#a1", "n#a2"]);
  });

  it("4.1c Run section on the second of two equal headings runs the cells of that one only", async () => {
    const { view, log } = sectionSetup();
    runButton(headings(view)[3]!)!.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(log).toEqual(["n#a3"]);
  });

  it("4.1c Run section on a top heading also runs the cells of its subsections, in order", async () => {
    const { view, log } = sectionSetup();
    runButton(headings(view)[0]!)!.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(log).toEqual(["n#t1", "n#a1", "n#a2", "n#b1", "n#a3"]);
  });
});

describe("A8 Run section", () => {
  it("A8 a heading offers Run section", () => {
    const view = mountView(BODY, foldWith({ runSection: () => undefined, canRun: () => true }));
    expect(headings(view).every((heading) => runButton(heading) !== null)).toBe(true);
  });
});

// --- note actions in mountQmdEditor
const EDITOR_BODY = "# Top\n\n## Alpha\n\n```{python}\nx = 1\n```\n\n## Beta\n\nplain text\n";

let mountedEditors: QmdEditorHandle[] = [];
afterEach(() => {
  for (const handle of mountedEditors) { try { handle.destroy(); } catch { /* already destroyed */ } }
  mountedEditors = [];
});

/** The actions a host passes: the note bar's own, wrapped so a test sees the scopes asked for. The bar has no editors, so a scope runs no cell. */
function actionsFake(canRun = true): NoteActions & { runScope: jest.Mock } {
  const bar = mountNoteBar(document.body.appendChild(document.createElement("div")), { editors: () => [], flush: () => undefined, restart: async () => undefined, canRun: () => canRun });
  const real = bar.actionsFor("n");
  return { runScope: jest.fn((scope: Parameters<NoteActions["runScope"]>[0]) => real.runScope(scope)), canRun: () => real.canRun() };
}

function editorSetup(extra: EditorExtra = {}): HTMLElement {
  actionsFake();
  const root = document.createElement("div");
  document.body.append(root);
  mountedEditors.push(mountQmdEditor(root, { body: EDITOR_BODY, onChange: () => undefined, ...extra }));
  return root;
}

const modShiftEnter = (target: Element): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, shiftKey: true, ctrlKey: true, metaKey: false, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};
const sectionRuns = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>("button.qmd-section-run")];

describe("editor headings", () => {
  it("4.1c shows a Run section button on every heading when noteActions is given", () => {
    const root = editorSetup({ noteActions: actionsFake() });
    expect(sectionRuns(root)).toHaveLength(3);
    expect(root.querySelectorAll(".qmd-section-toggle")).toHaveLength(3);
  });

  it("4.1c Run section runs the section scope with the heading's key", () => {
    const actions = actionsFake();
    const root = editorSetup({ noteActions: actions });
    sectionRuns(root)[1]!.click();
    expect(actions.runScope).toHaveBeenCalledWith({ kind: "section", section: "2:Alpha:0" });
  });

  it("4.1c disables Run section with the 'No runner for this note' title when the actions cannot run", () => {
    const actions = actionsFake(false);
    const root = editorSetup({ noteActions: actions });
    const button = sectionRuns(root)[0]!;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("No runner for this note");
    button.click();
    expect(actions.runScope).not.toHaveBeenCalled();
  });

  it("4.1c shows no Run section button without noteActions, and the chevron stays", () => {
    const root = editorSetup();
    expect(sectionRuns(root)).toHaveLength(0);
    expect(root.querySelectorAll(".qmd-section-toggle")).toHaveLength(3);
  });
});

describe("Mod-Shift-Enter", () => {
  it("4.1a runs the all scope from the editor", () => {
    const actions = actionsFake();
    const root = editorSetup({ noteActions: actions });
    modShiftEnter(root.querySelector(".ProseMirror")!);
    expect(actions.runScope).toHaveBeenCalledWith({ kind: "all" });
  });

  it("4.1a runs the all scope from inside a cell's code editor", () => {
    const actions = actionsFake();
    const root = editorSetup({ noteActions: actions });
    modShiftEnter(root.querySelector(".qmd-cell .cm-content")!);
    expect(actions.runScope).toHaveBeenCalledWith({ kind: "all" });
  });

  it("4.1a runs nothing when the actions cannot run", () => {
    const actions = actionsFake(false);
    const root = editorSetup({ noteActions: actions });
    modShiftEnter(root.querySelector(".ProseMirror")!);
    modShiftEnter(root.querySelector(".qmd-cell .cm-content")!);
    expect(actions.runScope).not.toHaveBeenCalled();
  });

  it("4.1a is not handled without noteActions", () => {
    const onRunCell = jest.fn();
    const root = editorSetup({ onRunCell });
    const before = root.querySelector(".ProseMirror")!.textContent;
    modShiftEnter(root.querySelector(".ProseMirror")!);
    modShiftEnter(root.querySelector(".qmd-cell .cm-content")!);
    expect(onRunCell).not.toHaveBeenCalled();
    expect(root.querySelector(".ProseMirror")!.textContent).toBe(before);
  });
});

describe("shortcut titles", () => {
  it("A8 the cell's Run button title still names Mod-Enter and Shift-Enter", () => {
    const root = editorSetup({ noteActions: actionsFake(), onRunCell: () => undefined });
    const title = root.querySelector(".qmd-cell-run")!.getAttribute("title")!;
    expect(title).toContain(shortcutLabel("Mod-Enter"));
    expect(title).toContain(shortcutLabel("Shift-Enter"));
  });
});
