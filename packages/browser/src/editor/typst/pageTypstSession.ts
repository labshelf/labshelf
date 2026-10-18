// Opens typst.ts in the page over a snapshot of the project's files, kept current as the workbench writes them.
import type { ILogger } from "@labshelf/core";
import { openTypstSession, type TypstSession } from "@labshelf/core/typst";
import type { BrowserProjects } from "../../storage/projects";
import { loadProjectSnapshot } from "./projectSnapshot";
import { loadTypstFonts } from "./typstFonts";

const MODULE = "browser.editor.typst";
const WASM = new URL("typst/typst_ts_web_compiler_bg.wasm", location.href);

export interface PageTypstSessionDeps {
  projects: BrowserProjects;
  projectId: string;
  logger: ILogger;
  /** Hears the project-relative path of every file written. */
  onFileWritten(listener: (relative: string) => void): void;
}

export async function openPageTypstSession({ projects, projectId, logger, onFileWritten }: PageTypstSessionDeps): Promise<TypstSession> {
  const snapshot = await loadProjectSnapshot(projects, projectId);
  onFileWritten((relative) => {
    snapshot.refresh(relative).catch((error: unknown) => logger.error(MODULE, error, { project: projectId, path: relative, action: "refresh the Typst snapshot" }));
  });
  const [wasm, fonts] = await Promise.all([fetch(WASM).then(async (response) => new Uint8Array(await response.arrayBuffer())), loadTypstFonts()]);
  await logger.log("INFO", MODULE, "Opened the Typst compiler", { project: projectId, fonts: fonts.length });
  // Typst Universe packages need a download the page does not make; a document importing one shows the compiler's error.
  return openTypstSession({ wasm, fonts, files: snapshot.access, packages: { resolve: () => undefined } });
}
