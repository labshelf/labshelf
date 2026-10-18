// Compiles the open Typst project in the page with typst.ts as the writer types, and shows the PDF in the side pane.
import type { ILogger } from "@labshelf/core";
import { openTypstSession, type TypstSession } from "@labshelf/core/typst";
import { getService, IModelService } from "@codingame/monaco-vscode-api/services";
import type { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import type { BrowserProjects } from "../../storage/projects";
import { renderPdfPages } from "./pdfPages";
import { compilerPath, COMPILER_ROOT, loadProjectSnapshot, type ProjectSnapshot } from "./projectSnapshot";
import type { SidePane } from "./sidePane";
import { loadTypstFonts } from "./typstFonts";

const MODULE = "browser.editor.typstPreview";
const DEBOUNCE_MS = 300;
const WASM = new URL("typst/typst_ts_web_compiler_bg.wasm", location.href);

export interface TypstPreviewDeps {
  projects: BrowserProjects;
  projectId: string;
  main: string;
  /** The project folder as the workbench names it. */
  folder: URI;
  pane: SidePane;
  logger: ILogger;
  /** Hears the project-relative path of every file the editor writes. */
  onFileWritten(listener: (relative: string) => void): void;
}

async function openSession(snapshot: ProjectSnapshot): Promise<TypstSession> {
  const [wasm, fonts] = await Promise.all([fetch(WASM).then(async (response) => new Uint8Array(await response.arrayBuffer())), loadTypstFonts()]);
  // Typst Universe packages need a download the page does not make; a document importing one shows the compiler's error.
  return openTypstSession({ wasm, fonts, files: snapshot.access, packages: { resolve: () => undefined } });
}

export async function startTypstPreview(deps: TypstPreviewDeps): Promise<void> {
  const { pane, logger, folder } = deps;
  pane.reveal();
  pane.status("Preparing the preview…");
  const snapshot = await loadProjectSnapshot(deps.projects, deps.projectId);
  const session = await openSession(snapshot);
  const models = await getService(IModelService);
  const relativeOf = (uri: URI): string | undefined => (uri.path.startsWith(`${folder.path}/`) ? uri.path.slice(folder.path.length + 1) : undefined);

  const compile = async (): Promise<void> => {
    const sources = new Map<string, string>();
    for (const model of models.getModels()) {
      const relative = relativeOf(model.uri);
      if (relative?.endsWith(".typ")) sources.set(compilerPath(relative), model.getValue());
    }
    const started = performance.now();
    const result = await session.compile({ root: COMPILER_ROOT, main: compilerPath(deps.main), sources });
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
    if (result.pdf) await renderPdfPages(pane.pages, result.pdf);
    pane.status(errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}; showing the last preview that compiled` : "");
    await logger.log("INFO", MODULE, "Typst preview compiled", { project: deps.projectId, ms: Math.round(performance.now() - started), errors });
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => void compile().catch((error: unknown) => logger.error(MODULE, error, { project: deps.projectId, action: "compile" })), DEBOUNCE_MS);
  };
  const watch = (model: { uri: URI; onDidChangeContent(listener: () => void): unknown }): void => {
    if (relativeOf(model.uri)?.endsWith(".typ")) model.onDidChangeContent(schedule);
  };
  models.getModels().forEach(watch);
  models.onModelAdded((model) => { watch(model); schedule(); });
  deps.onFileWritten((relative) => {
    snapshot.refresh(relative).then(schedule, (error: unknown) => logger.error(MODULE, error, { project: deps.projectId, path: relative, action: "refresh" }));
  });
  await compile();
}
