// Spec 2.3: the harness of the LaTeX and Typst deck workspace tests (workspace.test.ts, workspaceKeys.test.ts): the sample sources, the fake ports behind `mount` and the DOM helpers.
// Importing this module registers the teardown afterEach in the importing test file.
import { mountDeckWorkspace } from "../../../../src/decks/dom/workspace/index";
import type { DeckBuildState, DeckWorkspace, DeckWorkspaceMode, DeckWorkspacePorts } from "../../../../src/decks/dom/workspace/types";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const fixture = (name: string): string => readFileSync(join(__dirname, "..", "..", "fixtures", name), "utf8");
export const BEAMER = fixture("defesa-beamer.tex");
export const TIKZ = fixture("a1-tikz.tex");
export const TYPST = fixture("typst-a0.typ");
export const EMPTY_TALK = "% labshelf: talk\n\\documentclass{beamer}\n\\begin{document}\n\\end{document}\n";
export const EMPTY_POSTER = "% labshelf: poster\n\\documentclass{tikzposter}\n\\begin{document}\n\\maketitle\n\\end{document}\n";
export const COLUMN_ONLY_POSTER = "% labshelf: poster\n\\documentclass{tikzposter}\n\\begin{document}\n\\maketitle\n\\begin{columns}\n  \\column{0.5}\n\\end{columns}\n\\end{document}\n";

export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
export const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await tick(); };

export const apple = /Mac|iPhone|iPad/.test(navigator.platform) || /Mac|iPhone|iPad/.test(navigator.userAgent);
export const mod = (extra: KeyboardEventInit = {}): KeyboardEventInit => ({ metaKey: apple, ctrlKey: !apple, ...extra });
export function press(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

export interface Rig {
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

export function mount(path: string, initial: string, options: { mode?: DeckWorkspaceMode } = {}): Rig {
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

export const talk = (options: Parameters<typeof mount>[2] = {}): Rig => mount("talks/demo/main.tex", BEAMER, options);
export const poster = (options: Parameters<typeof mount>[2] = {}): Rig => mount("posters/demo/main.tex", TIKZ, options);
export const button = (root: ParentNode, label: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
export const statusLeft = (rig: Rig): string => rig.root.querySelector(".dw-status-left")!.textContent ?? "";
export const zoomLabel = (rig: Rig): string => rig.root.querySelector(".dw-zoom-label")!.textContent ?? "";
export const selectedRows = (rig: Rig, list: "Slides" | "Blocks"): Element[] => [...rig.root.querySelectorAll(`[aria-label="${list}"] [role="treeitem"][aria-selected="true"]`)];

/** The pure insertion that turned `before` into `after`: where it starts and what it adds; undefined when `after` also removed or changed text. */
export function insertion(before: string, after: string): { at: number; added: string } | undefined {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  const added = after.length - before.length;
  if (added <= 0 || after.slice(0, start) + after.slice(start + added) !== before) return undefined;
  return { at: start, added: after.slice(start, start + added) };
}
