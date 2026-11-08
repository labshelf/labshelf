/** @jest-environment jsdom */
// LaTeX and Typst decks run in the shell: mountDeckWorkspace over fake ports (editing, build, mode, pdf that reads nothing) renders the shell's header,
// zoom bar and layout, binds the shell keys on its root, and its insert buttons target the current slide or the poster's last block.
// Acceptance ids: A4 = the shell renders / the keys / the insert targets; A1 = existing behaviour holds (covered by the existing suites the command also runs).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readSourceDeckBlocks } from "../../../../src/decks/index.js";
import { mountDeckWorkspace } from "../../../../src/decks/dom/workspace/index";
import type { DeckBuildState, DeckWorkspace, DeckWorkspaceMode, DeckWorkspacePorts } from "../../../../src/decks/dom/workspace/types";

const fixture = (name: string): string => readFileSync(join(__dirname, "..", "..", "fixtures", name), "utf8");
const BEAMER = fixture("defesa-beamer.tex");
const TIKZ = fixture("a1-tikz.tex");
const TYPST = fixture("typst-a0.typ");
const EMPTY_TALK = "% labshelf: talk\n\\documentclass{beamer}\n\\begin{document}\n\\end{document}\n";
const EMPTY_POSTER = "% labshelf: poster\n\\documentclass{tikzposter}\n\\begin{document}\n\\maketitle\n\\end{document}\n";
const COLUMN_ONLY_POSTER = "% labshelf: poster\n\\documentclass{tikzposter}\n\\begin{document}\n\\maketitle\n\\begin{columns}\n  \\column{0.5}\n\\end{columns}\n\\end{document}\n";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await tick(); };

const apple = /Mac|iPhone|iPad/.test(navigator.platform) || /Mac|iPhone|iPad/.test(navigator.userAgent);
const mod = (extra: KeyboardEventInit = {}): KeyboardEventInit => ({ metaKey: apple, ctrlKey: !apple, ...extra });
function press(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

interface Rig {
  host: HTMLElement;
  workspace: DeckWorkspace;
  root: HTMLElement;
  editor: HTMLElement;
  calls: { present: number; posterPreview: number; exportPdf: number; showProblems: number; buildRun: number; undo: number; redo: number; unsubscribed: number; stoppedBuild: number };
  applied: string[];
  modes: DeckWorkspaceMode[];
  text(): string;
  emitBuild(state: DeckBuildState): void;
}

const mounted: Rig[] = [];
afterEach(() => { for (const rig of mounted.splice(0)) { rig.workspace.dispose(); rig.host.remove(); } });

function mount(path: string, initial: string, options: { mode?: DeckWorkspaceMode } = {}): Rig {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = document.createElement("div");
  editor.className = "source-editor";
  let current = initial;
  let buildListener: ((state: DeckBuildState) => void) | undefined;
  const calls = { present: 0, posterPreview: 0, exportPdf: 0, showProblems: 0, buildRun: 0, undo: 0, redo: 0, unsubscribed: 0, stoppedBuild: 0 };
  const applied: string[] = [];
  const modes: DeckWorkspaceMode[] = [];
  const ports: DeckWorkspacePorts = {
    path,
    editing: {
      text: () => current, cursor: () => 0, apply: (change) => { applied.push(change.text); current = change.text; }, reveal: () => undefined, select: () => undefined,
      undo: () => { calls.undo++; }, redo: () => { calls.redo++; },
    } as DeckWorkspacePorts["editing"],
    editor,
    subscribe: () => () => { calls.unsubscribed++; },
    pdf: { assets: { pdfjsUrl: "pdfjs.mjs", workerUrl: "worker.mjs" }, read: async () => undefined },
    build: { run: () => { calls.buildRun++; }, onState: (listener) => { buildListener = listener; listener({ state: "none", errors: 0 }); return () => { calls.stoppedBuild++; }; } },
    present: () => { calls.present++; }, posterPreview: () => { calls.posterPreview++; }, exportPdf: () => { calls.exportPdf++; }, showProblems: () => { calls.showProblems++; },
    mode: { read: () => options.mode ?? "visual", write: (mode) => { modes.push(mode); } },
  };
  const workspace = mountDeckWorkspace(host, ports);
  if (!workspace) throw new Error(`${path} is not a deck`);
  const rig: Rig = {
    host, workspace, root: host.querySelector<HTMLElement>(".dw")!, editor, calls, applied, modes, text: () => current,
    emitBuild: (state) => buildListener?.(state),
  };
  mounted.push(rig);
  return rig;
}

const talk = (options: Parameters<typeof mount>[2] = {}): Rig => mount("talks/demo/main.tex", BEAMER, options);
const poster = (options: Parameters<typeof mount>[2] = {}): Rig => mount("posters/demo/main.tex", TIKZ, options);
const button = (root: ParentNode, label: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const statusLeft = (rig: Rig): string => rig.root.querySelector(".dw-status-left")!.textContent ?? "";
const zoomLabel = (rig: Rig): string => rig.root.querySelector(".dw-zoom-label")!.textContent ?? "";
const selectedRows = (rig: Rig, list: "Slides" | "Blocks"): Element[] => [...rig.root.querySelectorAll(`[aria-label="${list}"] [role="treeitem"][aria-selected="true"]`)];

/** The pure insertion that turned `before` into `after`: where it starts and what it adds; undefined when `after` also removed or changed text. */
function insertion(before: string, after: string): { at: number; added: string } | undefined {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  const added = after.length - before.length;
  if (added <= 0 || after.slice(0, start) + after.slice(start + added) !== before) return undefined;
  return { at: start, added: after.slice(start, start + added) };
}

describe("the shell on a mounted workspace: header", () => {
  it("A4 renders Visual, Split and Code tabs with the mode selected", async () => {
    const rig = talk();
    await flush();
    const tabs = [...rig.root.querySelectorAll<HTMLElement>('.dw-header [role="tablist"][aria-label="Mode"] [role="tab"]')];
    expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual(["Visual", "Split", "Code"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
  });

  it("A4 a click on a tab changes the workspace mode, keeps it in the mode port and moves the selected tab and the root's data-mode", async () => {
    const rig = talk();
    await flush();
    button(rig.root, "Split").click();
    expect(rig.workspace.mode()).toBe("split");
    expect(rig.modes.at(-1)).toBe("split");
    expect(rig.root.dataset["mode"]).toBe("split");
    expect(button(rig.root, "Split").getAttribute("aria-selected")).toBe("true");
    expect(button(rig.root, "Visual").getAttribute("aria-selected")).toBe("false");
  });

  it("A4 workspace.setMode moves the selected tab and the root's data-mode too", async () => {
    const rig = talk();
    await flush();
    rig.workspace.setMode("code");
    expect(button(rig.root, "Code").getAttribute("aria-selected")).toBe("true");
    expect(rig.root.dataset["mode"]).toBe("code");
  });

  it("A4 starts in the mode the mode port keeps", async () => {
    const rig = talk({ mode: "split" });
    await flush();
    expect(rig.root.dataset["mode"]).toBe("split");
    expect(button(rig.root, "Split").getAttribute("aria-selected")).toBe("true");
  });

  it("A4 shows the LaTeX badge for a .tex deck and the Typst badge for a .typ deck", async () => {
    const latex = talk();
    const typst = mount("posters/demo/main.typ", TYPST);
    await flush();
    expect(latex.root.querySelector(".dw-header .dw-badge")!.textContent).toBe("LaTeX");
    expect(typst.root.querySelector(".dw-header .dw-badge")!.textContent).toBe("Typst");
  });

  it("A4 the root keeps class dw and data-kind and gains data-format", async () => {
    const latexTalk = talk();
    const typstPoster = mount("posters/demo/main.typ", TYPST);
    await flush();
    expect([latexTalk.root.dataset["format"], latexTalk.root.dataset["kind"]]).toEqual(["latex", "talk"]);
    expect([typstPoster.root.dataset["format"], typstPoster.root.dataset["kind"]]).toEqual(["typst", "poster"]);
  });

  it("A4 the build button follows the build state and a click on it builds", async () => {
    const rig = talk();
    await flush();
    const build = rig.root.querySelector<HTMLButtonElement>(".dw-header .dw-build")!;
    expect(build.dataset["state"]).toBe("none");
    build.click();
    expect(rig.calls.buildRun).toBe(1);
    rig.emitBuild({ state: "building", errors: 0 });
    expect(build.dataset["state"]).toBe("building");
    build.click();
    expect(rig.calls.buildRun).toBe(1);
    rig.emitBuild({ state: "succeeded", errors: 0 });
    expect(build.dataset["state"]).toBe("succeeded");
  });

  it("A4 the build button opens the problems after a failed build", async () => {
    const rig = talk();
    await flush();
    rig.emitBuild({ state: "failed", errors: 2 });
    const build = rig.root.querySelector<HTMLButtonElement>(".dw-header .dw-build")!;
    expect(build.dataset["state"]).toBe("failed");
    expect(build.textContent).toContain("2");
    build.click();
    expect(rig.calls.showProblems).toBe(1);
    expect(rig.calls.buildRun).toBe(0);
  });

  it("A4 a talk's header has Export PDF and Present, and Present calls ports.present", async () => {
    const rig = talk();
    await flush();
    const header = rig.root.querySelector(".dw-header")!;
    expect(button(header, "Export PDF")).not.toBeNull();
    expect(button(header, "Real size")).toBeNull();
    button(header, "Present").click();
    expect(rig.calls.present).toBe(1);
    expect(rig.calls.posterPreview).toBe(0);
  });

  it("A4 a poster's header has Export PDF and Real size, and Real size calls ports.posterPreview", async () => {
    const rig = poster();
    await flush();
    const header = rig.root.querySelector(".dw-header")!;
    expect(button(header, "Present")).toBeNull();
    button(header, "Real size").click();
    expect(rig.calls.posterPreview).toBe(1);
    expect(rig.calls.present).toBe(0);
  });

  it("A4 Export PDF calls ports.exportPdf", async () => {
    const rig = poster();
    await flush();
    button(rig.root.querySelector(".dw-header")!, "Export PDF").click();
    expect(rig.calls.exportPdf).toBe(1);
  });

  it("A4 Present and Real size are the header's primary button", async () => {
    const latexTalk = talk();
    const latexPoster = poster();
    await flush();
    expect(button(latexTalk.root, "Present").classList.contains("dw-primary")).toBe(true);
    expect(button(latexPoster.root, "Real size").classList.contains("dw-primary")).toBe(true);
  });
});

describe("the shell on a mounted workspace: zoom bar and layout", () => {
  it("A4 has the shell's zoom bar with Select, Hand, Guides, Zoom out, Zoom in and Fit inside the stage column", async () => {
    const rig = talk();
    await flush();
    const zoom = rig.root.querySelector<HTMLElement>('.dw-stage-column [role="toolbar"][aria-label="Zoom"]');
    expect(zoom).not.toBeNull();
    for (const label of ["Select", "Hand", "Guides", "Zoom out", "Zoom in", "Fit"]) expect(button(zoom!, label)).not.toBeNull();
  });

  it("A4 the Guides button toggles the guides and its pressed state", async () => {
    const rig = poster();
    await flush();
    const guides = button(rig.root, "Guides");
    expect(guides.getAttribute("aria-pressed")).toBe("false");
    guides.click();
    expect(guides.getAttribute("aria-pressed")).toBe("true");
    guides.click();
    expect(guides.getAttribute("aria-pressed")).toBe("false");
  });

  it("A4 the Hand and Select buttons switch the pressed tool", async () => {
    const rig = talk();
    await flush();
    expect(button(rig.root, "Select").getAttribute("aria-pressed")).toBe("true");
    button(rig.root, "Hand").click();
    expect(button(rig.root, "Hand").getAttribute("aria-pressed")).toBe("true");
    expect(button(rig.root, "Select").getAttribute("aria-pressed")).toBe("false");
    button(rig.root, "Select").click();
    expect(button(rig.root, "Select").getAttribute("aria-pressed")).toBe("true");
  });

  it("A4 the Zoom in and Fit buttons change the zoom label between N% and Fit · N%", async () => {
    const rig = talk();
    await flush();
    button(rig.root, "Zoom in").click();
    expect(zoomLabel(rig)).toMatch(/^\d+%$/);
    button(rig.root, "Fit").click();
    expect(zoomLabel(rig)).toMatch(/^Fit · \d+%$/);
  });

  it("A4 lays out the header, insert bar, body and status in that order", async () => {
    const rig = talk();
    await flush();
    expect([...rig.root.children].map((child) => child.className.split(" ")[0])).toEqual(["dw-header", "dw-insertbar", "dw-body", "dw-status"]);
  });

  it("A4 puts the host's editor in the code pane next to a resize divider", async () => {
    const rig = talk();
    await flush();
    const code = rig.root.querySelector(".dw-body > .dw-code")!;
    expect(code.contains(rig.editor)).toBe(true);
    expect(code.querySelector('[role="separator"][aria-label="Resize"]')).not.toBeNull();
  });

  it("A4 keeps the structure and properties panels around the stage column", async () => {
    const rig = poster();
    await flush();
    expect(rig.root.querySelector(".dw-body .dw-structure")).not.toBeNull();
    expect(rig.root.querySelector(".dw-body .dw-stage-column")).not.toBeNull();
  });

  it("A4 a talk has speaker notes under the stage", async () => {
    const rig = talk();
    await flush();
    const column = rig.root.querySelector(".dw-stage-column")!;
    expect(column.querySelector('textarea[aria-label="Speaker notes"]')).not.toBeNull();
  });

  it("A4 the status bar shows the slide of a talk and the shell's Previous and Next buttons", async () => {
    const rig = talk();
    await flush();
    expect(statusLeft(rig)).toMatch(/^Slide 1 of 4/);
    expect(button(rig.root.querySelector(".dw-status")!, "Previous slide").disabled).toBe(true);
    button(rig.root.querySelector(".dw-status")!, "Next slide").click();
    expect(statusLeft(rig)).toMatch(/^Slide 2 of 4/);
  });

  it("A4 workspace/header.ts no longer exists", () => {
    expect(existsSync(join(__dirname, "..", "..", "..", "..", "src", "decks", "dom", "workspace", "header.ts"))).toBe(false);
  });

  it("A4 dispose removes the root from the host and stops the ports' listeners", async () => {
    const rig = talk();
    await flush();
    rig.workspace.dispose();
    expect(rig.host.querySelector(".dw")).toBeNull();
    expect(rig.calls.unsubscribed).toBeGreaterThan(0);
    expect(rig.calls.stoppedBuild).toBeGreaterThan(0);
  });
});

describe("shell keys on a mounted compiled workspace", () => {
  it("A4 Mod+= zooms in and Mod+0 fits, both prevented", async () => {
    const rig = talk();
    await flush();
    const zoomIn = press(rig.root, "=", mod());
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(zoomLabel(rig)).toMatch(/^\d+%$/);
    const fit = press(rig.root, "0", mod());
    expect(fit.defaultPrevented).toBe(true);
    expect(zoomLabel(rig)).toMatch(/^Fit · \d+%$/);
  });

  it("A4 Mod+- zooms out", async () => {
    const rig = talk();
    await flush();
    press(rig.root, "-", mod());
    expect(zoomLabel(rig)).toMatch(/^\d+%$/);
  });

  it("A4 V and H pick the Select and Hand tools", async () => {
    const rig = talk();
    await flush();
    press(rig.root, "h");
    expect(button(rig.root, "Hand").getAttribute("aria-pressed")).toBe("true");
    press(rig.root, "v");
    expect(button(rig.root, "Select").getAttribute("aria-pressed")).toBe("true");
    expect(button(rig.root, "Hand").getAttribute("aria-pressed")).toBe("false");
  });

  it("A4 PageDown selects the next slide and PageUp the previous one", async () => {
    const rig = talk();
    await flush();
    expect(statusLeft(rig)).toMatch(/^Slide 1 of 4/);
    const down = press(rig.root, "PageDown");
    expect(down.defaultPrevented).toBe(true);
    expect(statusLeft(rig)).toMatch(/^Slide 2 of 4/);
    press(rig.root, "PageDown");
    expect(statusLeft(rig)).toMatch(/^Slide 3 of 4/);
    press(rig.root, "PageUp");
    expect(statusLeft(rig)).toMatch(/^Slide 2 of 4/);
  });

  it("A4 PageDown on the last slide and PageUp on the first stay where they are", async () => {
    const rig = talk();
    await flush();
    press(rig.root, "PageUp");
    expect(statusLeft(rig)).toMatch(/^Slide 1 of 4/);
    for (let i = 0; i < 6; i++) press(rig.root, "PageDown");
    expect(statusLeft(rig)).toMatch(/^Slide 4 of 4/);
  });

  it("A4 PageDown selects the slide in the structure panel too", async () => {
    const rig = talk();
    await flush();
    press(rig.root, "PageDown");
    const rows = [...rig.root.querySelectorAll('[aria-label="Slides"] [role="treeitem"]')];
    expect(rows.map((row) => row.getAttribute("aria-selected"))).toEqual(["false", "true", "false", "false"]);
  });

  it("A4 Escape clears the selection", async () => {
    const rig = poster();
    await flush();
    rig.root.querySelector<HTMLElement>('[aria-label="Blocks"] [data-kind="block"]')!.click();
    expect(selectedRows(rig, "Blocks")).toHaveLength(1);
    const escape = press(rig.root, "Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(selectedRows(rig, "Blocks")).toHaveLength(0);
  });

  it("A4 Mod+Z calls editing.undo, Mod+Shift+Z and Mod+Y call editing.redo", async () => {
    const rig = talk();
    await flush();
    expect(press(rig.root, "z", mod()).defaultPrevented).toBe(true);
    expect([rig.calls.undo, rig.calls.redo]).toEqual([1, 0]);
    press(rig.root, "Z", mod({ shiftKey: true }));
    expect([rig.calls.undo, rig.calls.redo]).toEqual([1, 1]);
    press(rig.root, "y", mod());
    expect([rig.calls.undo, rig.calls.redo]).toEqual([1, 2]);
  });

  it("A4 Delete removes the selected element in Visual mode", async () => {
    const rig = poster();
    await flush();
    rig.root.querySelector<HTMLElement>('[aria-label="Blocks"] [data-kind="block"]')!.click();
    expect(press(rig.root, "Delete").defaultPrevented).toBe(true);
    expect(rig.applied).toHaveLength(1);
    expect(rig.text()).not.toContain("What the problem is and why it matters.");
    expect(rig.text()).toContain("The main take-away in one sentence.");
  });

  it("A4 Mod+D duplicates the selected element in Visual mode", async () => {
    const rig = poster();
    await flush();
    rig.root.querySelector<HTMLElement>('[aria-label="Blocks"] [data-kind="block"]')!.click();
    press(rig.root, "d", mod());
    expect(rig.applied).toHaveLength(1);
    expect(rig.text().split("What the problem is and why it matters.")).toHaveLength(3);
  });

  it("A4 Delete changes nothing when nothing is selected", async () => {
    const rig = poster();
    await flush();
    press(rig.root, "Delete");
    expect(rig.applied).toHaveLength(0);
  });

  it("A4 Delete and Mod+D edit nothing outside Visual mode", async () => {
    const rig = poster();
    await flush();
    rig.root.querySelector<HTMLElement>('[aria-label="Blocks"] [data-kind="block"]')!.click();
    rig.workspace.setMode("code");
    press(rig.root, "Delete");
    press(rig.root, "d", mod());
    expect(rig.applied).toHaveLength(0);
  });

  it("A4 keys typed in the code editor (.cm-editor) are ignored", async () => {
    const rig = talk();
    await flush();
    const cm = document.createElement("div");
    cm.className = "cm-editor";
    const content = document.createElement("div");
    content.className = "cm-content";
    content.setAttribute("contenteditable", "true");
    cm.append(content);
    rig.editor.append(cm);
    const undo = press(content, "z", mod());
    const next = press(content, "PageDown");
    const fit = press(content, "0", mod());
    expect(undo.defaultPrevented).toBe(false);
    expect(next.defaultPrevented).toBe(false);
    expect(fit.defaultPrevented).toBe(false);
    expect(rig.calls.undo).toBe(0);
    expect(statusLeft(rig)).toMatch(/^Slide 1 of 4/);
  });

  it("A4 keys typed in the speaker notes box are ignored", async () => {
    const rig = talk();
    await flush();
    const notes = rig.root.querySelector<HTMLTextAreaElement>("textarea")!;
    const event = press(notes, "PageDown");
    expect(event.defaultPrevented).toBe(false);
    expect(statusLeft(rig)).toMatch(/^Slide 1 of 4/);
  });

  it("A4 keys do nothing after dispose", async () => {
    const rig = talk();
    await flush();
    const root = rig.root;
    rig.workspace.dispose();
    expect(press(root, "z", mod()).defaultPrevented).toBe(false);
    expect(rig.calls.undo).toBe(0);
  });
});

describe("insert buttons never wait for a selection", () => {
  const ELEMENTS = ["Text", "Figure", "Equation", "Table", "List"];
  const insertButton = (rig: Rig, label: string): HTMLButtonElement => button(rig.root.querySelector('[role="toolbar"][aria-label="Insert"]')!, label);

  it("A4 a talk with nothing selected has every element button enabled", async () => {
    const rig = talk();
    await flush();
    for (const label of ELEMENTS) expect([label, insertButton(rig, label).disabled]).toEqual([label, false]);
  });

  it("A4 a poster with nothing selected has every element button enabled", async () => {
    const rig = poster();
    await flush();
    for (const label of ELEMENTS) expect([label, insertButton(rig, label).disabled]).toEqual([label, false]);
  });

  it("A4 Text with nothing selected in a talk inserts into the first slide, the current one", async () => {
    const rig = talk();
    await flush();
    insertButton(rig, "Text").click();
    await flush();
    expect(rig.applied).toHaveLength(1);
    const slide = readSourceDeckBlocks("latex", "talk", BEAMER)[0]!;
    const added = insertion(BEAMER, rig.text());
    expect(added).toBeDefined();
    expect(added!.at).toBeGreaterThanOrEqual(slide.range[0]);
    expect(added!.at).toBeLessThanOrEqual(BEAMER.indexOf("\\end{frame}", slide.range[0]));
  });

  it("A4 Text in a talk inserts into the slide that is current after PageDown", async () => {
    const rig = talk();
    await flush();
    press(rig.root, "PageDown");
    insertButton(rig, "Text").click();
    await flush();
    const slide = readSourceDeckBlocks("latex", "talk", BEAMER)[1]!;
    const added = insertion(BEAMER, rig.text());
    expect(added).toBeDefined();
    expect(added!.at).toBeGreaterThanOrEqual(slide.range[0]);
    expect(added!.at).toBeLessThanOrEqual(BEAMER.indexOf("\\end{frame}", slide.range[0]));
  });

  it("A4 Text in a talk inserts into the slide chosen in the structure panel", async () => {
    const rig = talk();
    await flush();
    rig.root.querySelectorAll<HTMLElement>('[aria-label="Slides"] [role="treeitem"]')[2]!.click();
    insertButton(rig, "Text").click();
    await flush();
    const slide = readSourceDeckBlocks("latex", "talk", BEAMER)[2]!;
    const added = insertion(BEAMER, rig.text());
    expect(added).toBeDefined();
    expect(added!.at).toBeGreaterThanOrEqual(slide.range[0]);
    expect(added!.at).toBeLessThanOrEqual(BEAMER.indexOf("\\end{frame}", slide.range[0]));
  });

  it("A4 Text with nothing selected in a poster inserts after the last block", async () => {
    const rig = poster();
    await flush();
    insertButton(rig, "Text").click();
    await flush();
    expect(rig.applied).toHaveLength(1);
    const columns = readSourceDeckBlocks("latex", "poster", TIKZ);
    const last = columns.at(-1)!.children!.at(-1)!;
    expect(TIKZ.slice(last.range[0], last.range[1])).toContain("Conclusion");
    const added = insertion(TIKZ, rig.text());
    expect(added).toBeDefined();
    expect(added!.at).toBeGreaterThanOrEqual(last.range[1]);
    expect(added!.at).toBeLessThanOrEqual(TIKZ.indexOf("\\end{columns}"));
  });

  it("A4 the other element buttons insert too when nothing is selected", async () => {
    for (const label of ["Equation", "Table", "List"]) {
      const rig = poster();
      await flush();
      insertButton(rig, label).click();
      await flush();
      expect([label, rig.applied.length]).toEqual([label, 1]);
    }
  });

  it("A4 a talk with no slide disables the element buttons with 'Add a slide first'", async () => {
    const rig = mount("talks/empty/main.tex", EMPTY_TALK);
    await flush();
    for (const label of ELEMENTS) {
      const insert = insertButton(rig, label);
      expect([label, insert.disabled, insert.title]).toEqual([label, true, "Add a slide first"]);
    }
  });

  it("A4 a poster with no block disables the element buttons with 'Add a block first'", async () => {
    const rig = mount("posters/empty/main.tex", EMPTY_POSTER);
    await flush();
    for (const label of ELEMENTS) {
      const insert = insertButton(rig, label);
      expect([label, insert.disabled, insert.title]).toEqual([label, true, "Add a block first"]);
    }
  });

  it("A4 a poster with a column but no block disables the element buttons too", async () => {
    const rig = mount("posters/columns/main.tex", COLUMN_ONLY_POSTER);
    await flush();
    const insert = insertButton(rig, "Text");
    expect([insert.disabled, insert.title]).toEqual([true, "Add a block first"]);
  });
});
