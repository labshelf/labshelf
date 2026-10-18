/** Shared harness for the App test suite: a fake terminal, a fixed set of papers, and the key/mouse/frame helpers. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parse as parseYaml } from "yaml";

import { openLibrary, type AppContext } from "../../src/app/context";
import type { InputEvent } from "../../src/tui/input";
import type { Screen } from "../../src/tui/screen";
import type { TerminalSize } from "../../src/tui/terminal";
import { App, type TerminalLike } from "../../src/ui/app";

export class FakeTerminal implements TerminalLike {
  frames: Screen[] = [];
  raw: string[] = [];
  left = 0;
  size(): TerminalSize { return { cols: 120, rows: 30 }; }
  listen(): void { /* never called: the tests drive handle() directly */ }
  enter(): void { /* nothing to take over */ }
  leave(): void { this.left++; }
  draw(frame: Screen): void { this.frames.push(frame); }
  invalidate(): void { /* nothing to repaint */ }
  writeRaw(data: string): void { this.raw.push(data); }
  suspend<T>(run: () => T): T { return run(); }
  stopJob(): void { /* no job control in tests */ }
}

export interface PaperSpec {
  id: string;
  folder: string;
  title: string;
  authors?: string[];
  year?: number;
  status?: "unread" | "reading" | "done";
  tags?: string[];
  doi?: string;
  summary?: string;
  note?: string;
  pdf: boolean;
}

// Titles sort as: Attention, BERT, Gradient, On the Electrodynamics, Zebra.
export const PAPERS: PaperSpec[] = [
  {
    id: "vaswani2017attention", folder: "ML/Transformers", title: "Attention Is All You Need",
    authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017, status: "unread", tags: ["nlp", "transformers"],
    doi: "10.5555/3295222.3295349", summary: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.", pdf: true,
  },
  {
    id: "devlin2019bert", folder: "ML/Transformers", title: "BERT: Pre-training of Deep Bidirectional Transformers",
    authors: ["Jacob Devlin"], year: 2019, status: "reading", pdf: true,
  },
  {
    id: "lecun1998gradient", folder: "ML", title: "Gradient-Based Learning Applied to Document Recognition",
    authors: ["Yann LeCun"], year: 1998, status: "done", pdf: true,
  },
  {
    id: "einstein1905electrodynamics", folder: "Physics", title: "On the Electrodynamics of Moving Bodies",
    authors: ["Albert Einstein"], year: 1905, status: "done", pdf: false,
  },
  {
    id: "zebra2020study", folder: "", title: "Zebra Study of Stripes",
    authors: ["Zoe Zebra"], year: 2020, status: "unread", note: "Check the stripes", pdf: true,
  },
];

export const ATTENTION = "vaswani2017attention";
export const BERT = "devlin2019bert";
// "bert" alone would also match the author "Albert Einstein".
export const BERT_QUERY = "bidirectional";
export const LECUN = "lecun1998gradient";
export const EINSTEIN = "einstein1905electrodynamics";
export const ZEBRA = "zebra2020study";

export function yamlOf(spec: PaperSpec): string {
  const lines = [`title: ${JSON.stringify(spec.title)}`];
  if (spec.authors) { lines.push("authors:", ...spec.authors.map((a) => `  - ${JSON.stringify(a)}`)); }
  if (spec.year !== undefined) { lines.push(`year: ${spec.year}`); }
  lines.push(`citekey: ${spec.id}`, `status: ${spec.status ?? "unread"}`);
  if (spec.tags) { lines.push("tags:", ...spec.tags.map((t) => `  - ${JSON.stringify(t)}`)); }
  if (spec.doi) { lines.push(`doi: ${JSON.stringify(spec.doi)}`); }
  if (spec.summary) { lines.push(`summary: ${JSON.stringify(spec.summary)}`); }
  if (spec.note) { lines.push(`note: ${JSON.stringify(spec.note)}`); }
  return lines.join("\n") + "\n";
}

export async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

export const papersDir = (root: string): string => path.join(root, "papers");
export const folderDir = (root: string, folder: string): string => path.join(papersDir(root), ...folder.split("/").filter(Boolean));
export const paperDir = (root: string, folder: string, id: string): string => path.join(folderDir(root, folder), id);
export const folderOf = (id: string): string => PAPERS.find((p) => p.id === id)!.folder;

export async function writePaper(root: string, spec: PaperSpec): Promise<void> {
  const dir = paperDir(root, spec.folder, spec.id);
  await writeFile(path.join(dir, "metadata.yaml"), yamlOf(spec));
  if (spec.pdf) { await writeFile(path.join(dir, "paper.pdf"), "%PDF-1.4\n% LabShelf test fixture\n"); }
}

/** Writes every fixture paper and an empty "Empty" folder; the starting point of every App test. */
export async function seedLibrary(root: string): Promise<void> {
  for (const spec of PAPERS) { await writePaper(root, spec); }
  await fs.mkdir(folderDir(root, "Empty"), { recursive: true });
}

export async function readMeta(root: string, folder: string, id: string): Promise<Record<string, unknown>> {
  return parseYaml(await fs.readFile(path.join(paperDir(root, folder, id), "metadata.yaml"), "utf8")) as Record<string, unknown>;
}

export async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function writeSidecar(root: string, id: string, annotations: unknown[]): Promise<void> {
  await writeFile(path.join(root, ".research", "papers", id, "data.json"), JSON.stringify({ annotations, theme: "auto" }));
}

export function highlight(id: string, pageNumber: number, content: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `h-${pageNumber}`, paperId: id, type: "highlight", pageNumber, content, color: "yellow",
    position: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 },
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...extra,
  };
}

/** Opens a throwaway library at root (tmp is its parent, used for XDG isolation) with a fake terminal. */
export async function openApp(root: string, tmp: string): Promise<{ ctx: AppContext; term: FakeTerminal; app: App }> {
  const ctx = await openLibrary(root, {
    config: { version: 1 },
    watch: false,
    thumbnailWorkerUrl: new URL("file:///unused/thumbnailWorker.mjs"),
    env: { ...process.env, XDG_CONFIG_HOME: tmp, XDG_CACHE_HOME: tmp, XDG_STATE_HOME: tmp, LABSHELF_TOKEN_STORE: "file", LABSHELF_IMAGES: "off" },
  });
  const term = new FakeTerminal();
  const app = new App(ctx, term);
  return { ctx, term, app };
}

export function keyEvent(id: string): InputEvent {
  if (id === "space") { return { type: "key", id, text: " " }; }
  if ([...id].length === 1) { return { type: "key", id, text: id }; }
  return { type: "key", id };
}

export function press(app: App, ...ids: string[]): void {
  for (const id of ids) { app.handle(keyEvent(id)); }
}

export function typeText(app: App, text: string): void {
  for (const ch of text) { press(app, ch === " " ? "space" : ch); }
}

export function click(app: App, x: number, y: number, button = 0): void {
  app.handle({ type: "mouse", kind: "down", button, x, y });
}

export function wheel(app: App, kind: "wheel-up" | "wheel-down", x: number, y: number): void {
  app.handle({ type: "mouse", kind, button: 0, x, y });
}

export async function eventually(check: () => boolean | Promise<boolean>, what: string, app: App, timeoutMs = 2500): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await check()) { return; }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${what}.\nScreen:\n${app.frame().screen.toText()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// Waits for the background task a key press just started (tasks are registered synchronously).
export async function idle(app: App): Promise<void> {
  await eventually(() => app.tasks.size === 0, "background tasks to finish", app);
}

export const screenText = (app: App): string => app.frame().screen.toText();

// The text of one pane (or of the header / status bar). Only valid for the ASCII-and-box-drawing content used here,
// where every character takes exactly one cell.
export function pane(app: App, which: "header" | "folders" | "papers" | "preview" | "status"): string {
  const rect = app.layout[which];
  if (!rect) { return ""; }
  const screen = app.frame().screen;
  const rows: string[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) { rows.push(screen.rowText(y).slice(rect.x, rect.x + rect.w).trimEnd()); }
  return rows.join("\n");
}

export const hoveredId = (app: App): string | undefined => app.hoveredPaper()?.record.id;
export const ids = (app: App): string[] => app.papers().map((p) => p.record.id);

// The folders pane rows are: All papers, Unfiled, Empty, ML, ML/Transformers, Physics.
export function goToFolder(app: App, folder: string): void {
  const rows = app.folderRows().map((row) => row.key);
  const target = rows.indexOf(folder);
  if (target < 0) { throw new Error(`no such folder row: ${folder}`); }
  press(app, "h");
  press(app, "g", "g");
  for (let i = 0; i < target; i++) { press(app, "j"); }
}

export function makeTmpRoot(prefix = "labshelf-app-"): Promise<{ tmp: string; root: string }> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix)).then((tmp) => ({ tmp, root: path.join(tmp, "library") }));
}
