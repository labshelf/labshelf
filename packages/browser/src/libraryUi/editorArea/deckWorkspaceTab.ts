// The talk and poster workspace in a browser source tab: the built PDF beside the source in the library, builds through the Helper,
// an image picked from the project's files, a talk's included files read and written in the library and the mode kept per file in localStorage. The Helper sends no SyncTeX, so the stage
// finds nodes by their titles and words in the PDF.
import { checkRelativePath, formatError, listProjectFiles, posixPathOps, type ProjectEntry } from "@labshelf/core";
import { pickQuickEntry, showToast } from "@labshelf/core/dom";
import type { DeckBuildState, DeckWorkspace, DeckWorkspaceMode, DeckWorkspacePorts } from "@labshelf/core/deckWorkspace";
import type { DeckToolHooks, SourceEditor } from "@labshelf/core/sourceEditor";
import { getBrowserCellPorts } from "../../helper";
import { downloadBytes } from "../../platform";
import { createBrowserKitsPort } from "./deckKitsPort";
import { extensionPdfAssets } from "./deckTab";
import type { TabContext } from "./tabKinds";

const MODULE = "tabs.source.workspace";
const MODES: readonly DeckWorkspaceMode[] = ["visual", "split", "code", "grid"];
const IMAGE = /\.(png|jpe?g|pdf|svg|eps|gif|webp)$/i;

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

/** Mounts the workspace when the file is a talk or poster; undefined for any other file. */
export async function mountWorkspaceInTab(deps: WorkspaceTabDeps): Promise<DeckWorkspace | undefined> {
  const { context, entry, file, editor } = deps;
  const { fs, logger } = context;
  const { mountDeckWorkspace } = await import("@labshelf/core/deckWorkspace");
  const source = `${entry.folder.replace(/\/+$/, "")}/${file.path}`;
  const pdfPath = source.replace(/\.[^./]+$/, ".pdf");
  const folder = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
  const modeKey = `labshelf.deckMode.${file.projectId}.${file.path}`;
  let state: DeckBuildState = { state: "none", errors: 0 };
  const listeners = new Set<(state: DeckBuildState) => void>();
  const report = (next: DeckBuildState): void => { state = next; for (const listener of [...listeners]) listener(next); };
  const readPdf = async (): Promise<Uint8Array | undefined> => (await fs.exists(pdfPath)) ? await fs.readFile(pdfPath) : undefined;

  const build = async (): Promise<void> => {
    if (state.state === "building") return;
    report({ state: "building", errors: 0 });
    try {
      await editor.flush();
      const helper = getBrowserCellPorts(logger).helper();
      if (helper.status() === undefined) await helper.connect();
      const result = await helper.compile({ projectId: file.projectId, main: file.path, mode: "full" }, () => undefined);
      const errors = result.problems.filter((problem) => problem.severity === "error").length;
      report({ state: result.status === "succeeded" ? "succeeded" : "failed", errors });
    } catch (error) {
      void logger.error(MODULE, error, { action: "build", ...file });
      showToast(`Could not build ${file.path}: ${formatError(error)}`, "error");
      report({ state: "failed", errors: 0 });
    }
  };

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
    build: {
      run: () => void build(),
      onState: (listener) => {
        listeners.add(listener);
        // A PDF already beside the source counts as built until a build says otherwise.
        if (state.state === "none") void fs.exists(pdfPath).then((built) => { if (built && state.state === "none") report({ state: "succeeded", errors: 0 }); else listener(state); });
        else listener(state);
        return () => { listeners.delete(listener); };
      },
    },
    present: deps.hooks.present,
    posterPreview: deps.hooks.posterPreview,
    exportPdf: () => void readPdf().then((bytes) => {
      if (bytes) return downloadBytes(bytes, `${file.path.split("/").slice(-2, -1)[0] ?? "deck"}.pdf`, "application/pdf");
      showToast("Build the file first, then export its PDF.", "info");
      return undefined;
    }),
    showProblems: () => context.workspace.openTab("preview", { projectId: file.projectId }, 1),
    pickImage: async () => {
      const files = (await listProjectFiles({ fs, paths: posixPathOps }, entry.folder)).filter((path) => IMAGE.test(path));
      if (files.length === 0) { showToast("Add an image to the project first.", "info"); return undefined; }
      const picked = await pickQuickEntry(files.map((path) => ({ label: path.split("/").at(-1) ?? path, description: path, icon: "file-media" as const, value: path })), { placeholder: "Pick an image of the project" });
      return picked && posixPathOps.relative(folder || ".", picked);
    },
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
