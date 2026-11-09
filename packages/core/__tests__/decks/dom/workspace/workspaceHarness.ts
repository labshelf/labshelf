// Spec 2.3: the harness of the LaTeX and Typst deck workspace tests (workspace.test.ts, workspaceKeys.test.ts): the sample sources, the fake ports behind `mount` and the DOM helpers.
// Spec 7.1 extends it for workspaceSync.test.ts: a settable cursor, the recorded reveal/select/open calls, the captured editor cursor and
// file cursor listeners, and optional links, a PDF (the caller mocks openPdfDeck) and included files. Spec 7.3 adds an optional dropImage port.
// Importing this module registers the teardown afterEach in the importing test file.
import { mountDeckWorkspace } from "../../../../src/decks/dom/workspace/index";
import type { DeckBuildState, DeckSourceLinks, DeckWorkspace, DeckWorkspaceMode, DeckWorkspacePorts } from "../../../../src/decks/dom/workspace/types";
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
  /** editing.select calls as [from, to]; select leaves the cursor at `to`, as CodeMirror's head. */
  selects: Array<[number, number]>;
  /** editing.reveal offsets; reveal leaves the cursor there. */
  reveals: number[];
  /** editing.focus ranges as [from, to], null for the whole file; a cursor outside the range moves to the given cursor or the range's start. */
  focuses: Array<[number, number] | null>;
  /** files.open calls as [path, line, options]. */
  opens: Array<[string, number, { preserveFocus?: boolean } | undefined]>;
  /** The editor's cursor as editing.cursor() answers it. */
  cursor(): number;
  /** Moves the editor's cursor and tells the workspace, as the editor's own cursor event. */
  moveCursor(offset: number): void;
  /** The host's cursor in another project file moved; false when the workspace did not subscribe. */
  fileCursor(path: string, line: number): boolean;
  /** Whether a files.onCursor listener is still subscribed. */
  fileCursorSubscribed(): boolean;
}

export interface MountOptions {
  mode?: DeckWorkspaceMode;
  links?: DeckSourceLinks;
  /** pdf.read answers bytes, so the stage opens a PDF through openPdfDeck (which the test mocks). */
  pdf?: boolean;
  /** Included files by project-relative path: a files port with read, write, open and onCursor. */
  files?: Record<string, string>;
  /** Spec 7.3: the port that resolves a dropped image (workspaceDrop.test.ts). */
  dropImage?: DeckWorkspacePorts["dropImage"];
}

const mounted: Rig[] = [];
afterEach(() => { for (const rig of mounted.splice(0)) { rig.workspace.dispose(); rig.host.remove(); } });

export function mount(path: string, initial: string, options: MountOptions = {}): Rig {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = document.createElement("div");
  editor.className = "source-editor";
  let current = initial;
  let buildListener: ((state: DeckBuildState) => void) | undefined;
  const calls = { present: 0, posterPreview: 0, exportPdf: 0, showProblems: 0, buildRun: 0, undo: 0, redo: 0, unsubscribed: 0, stoppedBuild: 0 };
  const applied: string[] = [];
  const modes: DeckWorkspaceMode[] = [];
  let cursor = 0;
  const selects: Rig["selects"] = []; const reveals: number[] = []; const opens: Rig["opens"] = []; const focuses: Rig["focuses"] = [];
  let editorListener: { text(): void; cursor(offset: number): void } | undefined;
  let fileListener: ((path: string, line: number) => void) | undefined;
  const disk = new Map(Object.entries(options.files ?? {}));
  const ports: DeckWorkspacePorts = {
    path,
    editing: {
      text: () => current, cursor: () => cursor, apply: (change) => { applied.push(change.text); current = change.text; },
      reveal: (offset) => { reveals.push(offset); cursor = offset; }, select: (from, to) => { selects.push([from, to]); cursor = to; },
      focus: (range, at) => {
        focuses.push(range && [range.from, range.to]);
        if (range && (cursor < range.from || cursor > range.to)) cursor = at ?? range.from;
        return cursor;
      },
      undo: () => { calls.undo++; }, redo: () => { calls.redo++; },
    } as DeckWorkspacePorts["editing"],
    editor,
    subscribe: (listener) => { editorListener = listener; return () => { calls.unsubscribed++; editorListener = undefined; }; },
    pdf: { assets: { pdfjsUrl: "pdfjs.mjs", workerUrl: "worker.mjs" }, read: async () => (options.pdf ? new ArrayBuffer(1) : undefined) },
    ...(options.links ? { links: options.links } : {}),
    ...(options.files ? {
      files: {
        read: async (file: string) => disk.get(file),
        write: async (file: string, text: string) => { disk.set(file, text); },
        open: (file: string, line: number, openOptions?: { preserveFocus?: boolean }) => { opens.push([file, line, openOptions]); },
        onCursor: (listener: (file: string, line: number) => void) => { fileListener = listener; return () => { fileListener = undefined; }; },
      },
    } : {}),
    build: { run: () => { calls.buildRun++; }, onState: (listener) => { buildListener = listener; listener({ state: "none", errors: 0 }); return () => { calls.stoppedBuild++; }; } },
    present: () => { calls.present++; }, posterPreview: () => { calls.posterPreview++; }, exportPdf: () => { calls.exportPdf++; }, showProblems: () => { calls.showProblems++; },
    mode: { read: () => options.mode ?? "visual", write: (mode) => { modes.push(mode); } },
    ...(options.dropImage ? { dropImage: options.dropImage } : {}),
  };
  const workspace = mountDeckWorkspace(host, ports);
  if (!workspace) throw new Error(`${path} is not a deck`);
  const rig: Rig = {
    host, workspace, root: host.querySelector<HTMLElement>(".dw")!, editor, calls, applied, modes, text: () => current,
    emitBuild: (state) => buildListener?.(state),
    selects, reveals, opens, focuses, cursor: () => cursor,
    moveCursor: (offset) => { cursor = offset; editorListener?.cursor(offset); },
    fileCursor: (file, line) => { if (!fileListener) return false; fileListener(file, line); return true; },
    fileCursorSubscribed: () => fileListener !== undefined,
  };
  mounted.push(rig);
  return rig;
}

export const talk = (options: Parameters<typeof mount>[2] = {}): Rig => mount("talks/demo/main.tex", BEAMER, options);
export const poster = (options: Parameters<typeof mount>[2] = {}): Rig => mount("posters/demo/main.tex", TIKZ, options);
export const button = (root: ParentNode, label: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
export const statusLeft = (rig: Rig): string => rig.root.querySelector(".dw-status-left")!.textContent ?? "";
export const zoomLabel = (rig: Rig): string => rig.root.querySelector(".dw-zoom-label")!.textContent ?? "";
/** The slide rows of a talk's structure panel, without the Preamble row Split lists first. */
export const slideRows = (rig: Rig): HTMLElement[] => [...rig.root.querySelectorAll<HTMLElement>('[aria-label="Slides"] [role="treeitem"]:not(.dw-preamble)')];
export const selectedRows = (rig: Rig, list: "Slides" | "Blocks"): Element[] => [...rig.root.querySelectorAll(`[aria-label="${list}"] [role="treeitem"][aria-selected="true"]`)];

/** The pure insertion that turned `before` into `after`: where it starts and what it adds; undefined when `after` also removed or changed text. */
export function insertion(before: string, after: string): { at: number; added: string } | undefined {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  const added = after.length - before.length;
  if (added <= 0 || after.slice(0, start) + after.slice(start + added) !== before) return undefined;
  return { at: start, added: after.slice(start, start + added) };
}
