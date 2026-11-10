// Tab bodies for files on /open/: LaTeX, Typst and Bib sources in core's source editor with Compile, notes in the note editor,
// other text read-only, a deck in the share viewer and a PDF ready to present.
import { formatError, type ILogger, type PaperRecord } from "@labshelf/core";
import { renderElement, showToast, type EditorTabBody } from "@labshelf/core/dom";

import { saveFile } from "../share/shareDownloads.js";
import type { MirrorFileSystem } from "./mirrorFileSystem.js";
import type { MirrorProject } from "./mirrorProjects.js";
import { mountNoteFile, type NoteCells } from "./noteTab.js";
import { compileInBrowser, LATEX_EXPERIMENTAL_NOTICE } from "./runtimes/index.js";
import { exitFullscreen } from "./sourceView.js";

type Mounted = { destroy(): void } | undefined;

/** What a project file's tab reads, writes and runs with. */
export interface FileTabContext {
  fs: MirrorFileSystem;
  project: MirrorProject;
  cells: NoteCells;
  papers(): Promise<readonly PaperRecord[]>;
  logger: ILogger;
  /** Opens a PDF tab named `name` with the bytes `load` gives. */
  openPdf(name: string, load: () => Promise<Uint8Array>): void;
}

const EDITOR_FILE = /\.(tex|typ|bib|sty|cls)$/i;
const NOTE_FILE = /\.(qmd|md)$/i;

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const projectPath = (project: MirrorProject, file: string): string => `projects/${project.folder}/${file}`;

/** Shows "Loading…", then what `fill` mounts; a failure shows in the tab. */
export function loadInto(el: HTMLElement, fill: (body: HTMLElement) => Promise<Mounted>, cleanup?: () => void): EditorTabBody {
  const body = document.createElement("div");
  body.className = "open-tab-body";
  body.textContent = "Loading…";
  el.append(body);
  let mounted: Mounted;
  let disposed = false;
  fill(body).then((m) => { mounted = m; if (disposed) { m?.destroy(); } }).catch((err: unknown) => {
    if (!disposed) { body.textContent = `Could not open this: ${formatError(err)}`; }
  });
  return { dispose: () => { disposed = true; mounted?.destroy(); cleanup?.(); body.remove(); } };
}

/** The project's format: labshelf.yaml's, else the main file's extension. */
const projectFormat = (project: MirrorProject, main: string): "typst" | "latex" => project.format ?? (/\.typ$/i.test(main) ? "typst" : "latex");

/** Reads every source (as UTF-8 bytes) and asset of the project into the compiler's input map, keyed by project-relative path. */
async function compileInputs(context: FileTabContext): Promise<Map<string, Uint8Array>> {
  const { fs, project } = context;
  const files = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();
  await Promise.all([
    ...project.files.map(async (file) => { files.set(file, encoder.encode(await fs.readText(projectPath(project, file)))); }),
    ...project.assets.map(async (file) => { files.set(file, await fs.readFile(projectPath(project, file))); }),
  ]);
  return files;
}

/** The Compile bar of a LaTeX or Typst file: compiles the project's main file in the browser and opens the PDF in a tab, listing the problems under it. */
function renderCompileBar(context: FileTabContext, file: string, beforeCompile: () => Promise<unknown>): HTMLElement {
  const main = context.project.main ?? file;
  const format = projectFormat(context.project, main);
  const bar = renderElement("div", { class: "open-compile" });
  const button = renderElement("button", { class: "ls-btn ls-btn-primary", type: "button", text: "Compile" });
  const state = renderElement("span", { class: "open-compile-state" });
  const problems = renderElement("ul", { class: "open-compile-problems" });
  bar.append(button, state);
  if (format === "latex") { bar.append(renderElement("p", { class: "open-compile-notice", text: LATEX_EXPERIMENTAL_NOTICE })); }
  bar.append(problems);
  button.addEventListener("click", () => {
    button.disabled = true;
    state.textContent = `Compiling ${main}…`;
    problems.replaceChildren();
    void (async () => {
      try {
        await beforeCompile();
        const onProgress = ({ percent }: { percent: number }): void => {
          state.textContent = percent < 100 ? `Downloading the LaTeX engine… ${percent}%` : `Compiling ${main}…`;
        };
        const result = await compileInBrowser({ format, main, files: await compileInputs(context), onProgress });
        for (const d of result.diagnostics) {
          const where = d.file === undefined ? "" : `${d.file}${d.line === undefined ? "" : `:${d.line}`}: `;
          problems.append(renderElement("li", { class: `open-compile-${d.severity}`, text: `${where}${d.message}` }));
        }
        const pdf = result.pdf;
        state.textContent = pdf ? "Compiled." : "The compile made no PDF.";
        if (pdf) { context.openPdf(`${baseName(main).replace(/\.[^.]+$/, "")}.pdf`, async () => pdf); }
      } catch (err) {
        state.textContent = `Could not compile: ${formatError(err)}`;
      } finally {
        button.disabled = false;
      }
    })();
  });
  return bar;
}

/** A LaTeX, Typst, Bib, style or class file in core's source editor; each save is an edit of the Mirror's row, and a refused one shows why. */
async function mountEditorFile(body: HTMLElement, context: FileTabContext, file: string): Promise<Mounted> {
  const { fs, project, logger } = context;
  const { mountSourceEditor } = await import("@labshelf/core/sourceEditor");
  body.textContent = "";
  const holder = renderElement("div", { class: "open-source-editor" });
  const editor = await mountSourceEditor(holder, {
    projectId: project.id, path: file, papers: context.papers, helper: undefined, logger, onDirty: () => undefined,
    files: {
      list: async () => [...project.files, ...project.assets],
      read: (path) => fs.readText(projectPath(project, path)),
      write: async (path, text) => {
        try { await fs.writeText(projectPath(project, path), text); } catch (err) { showToast(formatError(err), "error"); throw err; }
      },
    },
  });
  if (/\.(tex|typ)$/i.test(file)) { body.append(renderCompileBar(context, file, () => editor.flush())); }
  body.append(holder);
  return { destroy: () => { void editor.dispose(); holder.remove(); } };
}

/** A project file's tab: a source in the source editor, a note in the note editor, any other text read-only. */
export function mountSourceTab(el: HTMLElement, context: FileTabContext, file: string): EditorTabBody {
  return loadInto(el, async (body) => {
    body.classList.add("open-source");
    if (EDITOR_FILE.test(file)) { return mountEditorFile(body, context, file); }
    if (NOTE_FILE.test(file)) { return mountNoteFile(body, { fs: context.fs, cells: context.cells, path: projectPath(context.project, file) }); }
    const text = await context.fs.readText(projectPath(context.project, file));
    body.textContent = "";
    const pre = renderElement("pre", { class: "open-source-text", text });
    body.append(pre);
    return { destroy: () => { pre.remove(); } };
  });
}

/** A deck in the share viewer, whose Present goes full screen; its script runs in a frame without the page's origin. */
export function mountDeckTab(el: HTMLElement, path: string, read: (path: string) => Promise<string>): EditorTabBody {
  return loadInto(el, async (body) => {
    const html = await read(path);
    body.textContent = "";
    const { mountDeckShareViewer } = await import("@labshelf/core/dom");
    const title = path.split("/").slice(-2, -1)[0] ?? baseName(path);
    return mountDeckShareViewer(body, {
      title, deck: /poster/i.test(path) ? "poster" : "talk", html,
      download: (bytes, filename) => { saveFile(filename, bytes, "text/html"); },
    });
  });
}

/** A PDF (a compiled output, a paper's PDF or a compile result) in a frame, with Present (one click to full screen) and Download. */
export function mountPdfTab(el: HTMLElement, name: string, load: () => Promise<Uint8Array>): EditorTabBody {
  let url: string | undefined;
  return loadInto(el, async (body) => {
    const bytes = await load();
    url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const viewer = document.createElement("div");
    viewer.className = "open-pdf";
    const bar = document.createElement("div");
    bar.className = "open-pdf-bar";
    const title = document.createElement("strong");
    title.textContent = name;
    const present = document.createElement("button");
    present.type = "button";
    present.className = "ls-btn ls-btn-primary";
    present.textContent = "Present";
    present.addEventListener("click", () => { viewer.requestFullscreen?.().catch(() => undefined); });
    const download = document.createElement("button");
    download.type = "button";
    download.className = "ls-btn";
    download.textContent = "Download";
    download.addEventListener("click", () => { saveFile(name, bytes, "application/pdf"); });
    bar.append(title, present, download);
    const frame = document.createElement("iframe");
    frame.className = "open-pdf-frame";
    frame.title = name;
    frame.src = url;
    viewer.append(bar, frame);
    body.replaceChildren(viewer);
    return { destroy: () => { if (document.fullscreenElement === viewer) { exitFullscreen(); } viewer.remove(); } };
  }, () => { if (url) { URL.revokeObjectURL(url); } });
}
