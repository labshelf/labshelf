// The talk and poster workspace in a browser source tab: the built PDF beside the source in the library, builds through the Helper,
// an image picked from the project's files, a talk's included files read and written in the library and the mode kept per file in localStorage. The Helper's
// build reply carries the page map that links pages and poster blocks to the source.
import {
  addPrintMarks, checkRelativePath, describeSourceDeck, formatError, keepDeckPageMap, lastDeckPageMap, layoutTalkPdf, listProjectFiles, posixPathOps, readSourceDeckKind,
  readTalkPages, type ProjectEntry,
} from "@labshelf/core";
import { pickQuickEntry, showToast } from "@labshelf/core/dom";
import type { DeckBuildState, DeckWorkspace, DeckWorkspaceMode, DeckWorkspacePorts } from "@labshelf/core/deckWorkspace";
import type { DeckToolHooks, SourceEditor } from "@labshelf/core/sourceEditor";
import { getBrowserCellPorts } from "../../helper";
import { downloadBytes } from "../../platform";
import { createBrowserKitsPort } from "./deckKitsPort";
import { extensionPdfAssets, pickPosterPdfMarks, pickTalkPdfLayout } from "./deckTab";
import type { TabContext } from "./tabKinds";

const MODULE = "tabs.source.workspace";
const MODES: readonly DeckWorkspaceMode[] = ["visual", "split", "code", "grid"];
const IMAGE = /\.(png|jpe?g|pdf|svg|eps|gif|webp)$/i;
/** Typst's image() takes no pdf or eps. */
const TYPST_IMAGE = /\.(png|jpe?g|svg|gif|webp)$/i;

/**
 * The path, relative to the deck's folder, of the first image dropped from the project file tree; undefined when there is none: a file of
 * another project (the sidebar names the open project by its folder, tabs by its id, so both count), not an image, pdf or eps in a Typst
 * deck, or a path that leaves the project.
 */
export function resolveDroppedImage(files: ReadonlyArray<{ projectId: string; path: string }>, deck: { projectIds: readonly string[]; folder: string; typst: boolean }): string | undefined {
  const image = deck.typst ? TYPST_IMAGE : IMAGE;
  const dropped = files.find((candidate) => deck.projectIds.includes(candidate.projectId) && checkRelativePath(candidate.path) === undefined && image.test(candidate.path));
  return dropped && posixPathOps.relative(deck.folder || ".", dropped.path);
}

/**
 * Downloads a LaTeX talk's or poster's built PDF: a poster asks for bleed and crop marks, a talk for a handout or notes pages (laid out with
 * the notes of its source, placed on the pages by the last build's page map, as `<name>-handout.pdf` or `<name>-notes.pdf`); a dismissed
 * pick downloads nothing.
 */
export async function downloadBuiltDeckPdf(projectId: string, path: string, text: string, bytes: Uint8Array): Promise<void> {
  const name = path.split("/").slice(-2, -1)[0] ?? "deck";
  const kind = readSourceDeckKind(path, text);
  const marks = kind === "poster" ? await pickPosterPdfMarks() : null;
  if (marks === undefined) return;
  const layout = kind === "talk" ? await pickTalkPdfLayout() : null;
  if (layout === undefined) return;
  if (layout) {
    const format = path.endsWith(".typ") ? "typst" : "latex";
    const deck = describeSourceDeck(format, path, text);
    // Without the build's page map no page is placed: the notes stay off the pages rather than land on the wrong ones.
    const pages = readTalkPages(lastDeckPageMap(projectId, path), path, text) ?? { slideOfPage: [] };
    const pdf = await layoutTalkPdf(bytes, layout, { notes: deck?.notes ?? [], ...pages, format });
    await downloadBytes(pdf, `${name}-${layout.kind === "handout" ? "handout" : "notes"}.pdf`, "application/pdf");
    return;
  }
  await downloadBytes(marks ? await addPrintMarks(bytes, marks) : bytes, `${name}.pdf`, "application/pdf");
}

export interface WorkspaceTabDeps {
  host: HTMLElement;
  /** The tab's body: the editor's toolbar and text, which the workspace moves into its code pane. */
  body: HTMLElement;
  context: TabContext;
  entry: ProjectEntry;
  file: { projectId: string; path: string };
  editor: SourceEditor;
  subscribe: DeckWorkspacePorts["subscribe"];
  hooks: DeckToolHooks;
}

type WorkspaceBuild = DeckWorkspacePorts["build"];

/**
 * Builds the file through the Helper and reports each build's state; a PDF already at `pdfPath` counts as built until a build says otherwise.
 * `folder` is the file's project-relative folder, which overflow locations are rebased onto.
 */
function createTabBuild(deps: WorkspaceTabDeps, pdfPath: string, folder: string): WorkspaceBuild {
  const { context: { fs, logger }, file, editor } = deps;
  let state: DeckBuildState = { state: "none", errors: 0 };
  const listeners = new Set<(state: DeckBuildState) => void>();
  const report = (next: DeckBuildState): void => { state = next; for (const listener of [...listeners]) listener(next); };
  const build = async (): Promise<void> => {
    if (state.state === "building") return;
    report({ state: "building", errors: 0 });
    try {
      await editor.flush();
      const helper = getBrowserCellPorts(logger).helper();
      if (helper.status() === undefined) await helper.connect();
      const result = await helper.compile({ projectId: file.projectId, main: file.path, mode: "full" }, () => undefined);
      const errors = result.problems.filter((problem) => problem.severity === "error").length;
      // The Helper names files relative to the main file's folder; the overflow badges want them relative to the project.
      const overflow = result.problems.flatMap((problem) => (problem.kind === "overfullPage" && problem.line !== undefined
        ? [{ file: posixPathOps.join(folder, problem.file), line: problem.line }] : []));
      // A failed build leaves the last good map in place for Present and handouts of the PDF still in the library.
      if (result.status === "succeeded") keepDeckPageMap(file.projectId, file.path, result.pageMap);
      report({ state: result.status === "succeeded" ? "succeeded" : "failed", errors, ...(overflow.length ? { overflow } : {}), ...(result.pageMap && { pageMap: result.pageMap }) });
    } catch (error) {
      void logger.error(MODULE, error, { action: "build", ...file });
      showToast(`Could not build ${file.path}: ${formatError(error)}`, "error");
      report({ state: "failed", errors: 0 });
    }
  };
  return {
    run: () => void build(),
    onState: (listener) => {
      listeners.add(listener);
      // A PDF already beside the source counts as built until a build says otherwise.
      if (state.state === "none") void fs.exists(pdfPath).then((built) => { if (built && state.state === "none") report({ state: "succeeded", errors: 0 }); else listener(state); });
      else listener(state);
      return () => { listeners.delete(listener); };
    },
  };
}

/** Mounts the workspace when the file is a talk or poster; undefined for any other file. */
export async function mountWorkspaceInTab(deps: WorkspaceTabDeps): Promise<DeckWorkspace | undefined> {
  const { context, entry, file, editor } = deps;
  const { fs } = context;
  const { mountDeckWorkspace } = await import("@labshelf/core/deckWorkspace");
  const source = `${entry.folder.replace(/\/+$/, "")}/${file.path}`;
  const pdfPath = source.replace(/\.[^./]+$/, ".pdf");
  const folder = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
  const modeKey = `labshelf.deckMode.${file.projectId}.${file.path}`;
  const readPdf = async (): Promise<Uint8Array | undefined> => (await fs.exists(pdfPath)) ? await fs.readFile(pdfPath) : undefined;
  return mountDeckWorkspace(deps.host, {
    path: file.path,
    editing: editor.deck,
    editor: deps.body,
    subscribe: deps.subscribe,
    pdf: {
      assets: extensionPdfAssets(),
      read: async () => { const bytes = await readPdf(); return bytes?.slice().buffer; },
      createWorker: (url) => new Worker(url, { type: "module" }),
    },
    build: createTabBuild(deps, pdfPath, folder),
    present: deps.hooks.present,
    posterPreview: deps.hooks.posterPreview,
    exportPdf: () => void readPdf().then(async (bytes) => {
      if (!bytes) { showToast("Build the file first, then export its PDF.", "info"); return; }
      await downloadBuiltDeckPdf(file.projectId, file.path, (await fs.exists(source)) ? await fs.readText(source) : "", bytes);
    }).catch((error: unknown) => showToast(`PDF export failed: ${formatError(error)}`, "error")),
    showProblems: () => context.workspace.openTab("preview", { projectId: file.projectId }, 1),
    pickImage: async () => {
      const files = (await listProjectFiles({ fs, paths: posixPathOps }, entry.folder)).filter((path) => IMAGE.test(path));
      if (files.length === 0) { showToast("Add an image to the project first.", "info"); return undefined; }
      const picked = await pickQuickEntry(files.map((path) => ({ label: path.split("/").at(-1) ?? path, description: path, icon: "file-media" as const, value: path })), { placeholder: "Pick an image of the project" });
      return picked && posixPathOps.relative(folder || ".", picked);
    },
    dropImage: async (drop) => resolveDroppedImage(drop.files, { projectIds: [file.projectId, entry.folder], folder, typst: file.path.endsWith(".typ") }),
    kits: createBrowserKitsPort(fs),
    // A talk's included files, by project-relative path; a path that leaves the project is neither read nor written.
    files: {
      read: async (path) => {
        if (checkRelativePath(path) !== undefined) return undefined;
        const target = `${entry.folder.replace(/\/+$/, "")}/${path}`;
        return (await fs.exists(target)) ? await fs.readText(target) : undefined;
      },
      write: async (path, text) => {
        if (checkRelativePath(path) !== undefined) throw new Error("outside the project");
        await fs.writeText(`${entry.folder.replace(/\/+$/, "")}/${path}`, text);
      },
    },
    mode: {
      read: () => { try { return MODES.find((mode) => mode === window.localStorage.getItem(modeKey)); } catch { return undefined; } },
      write: (mode) => { try { window.localStorage.setItem(modeKey, mode); } catch { /* PLATFORM: blocked storage keeps the mode for this tab only. */ } },
    },
  });
}
