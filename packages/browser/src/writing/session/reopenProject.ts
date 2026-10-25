// Reopens the project whose tabs a page load restored, so the sidebar, the helper and the comments follow it.
import type { ILogger, LibraryFileSystem } from "@labshelf/core";
import { parseTab } from "../../libraryUi/editorArea";
import type { Workspace } from "../../libraryUi/editorArea";
import type { ProjectSession } from "./projectSession";

const MODULE = "writing.session";

export async function openRestoredProject(workspace: Pick<Workspace, "tabs" | "openTab">, session: ProjectSession, fs: LibraryFileSystem, logger: ILogger): Promise<void> {
  const tabs = workspace.tabs();
  const projectId = tabs.map((t) => parseTab(t.id)?.params["projectId"]).find((id) => id !== undefined);
  if (projectId === undefined) return;
  try {
    // Loaded on demand, so a page without project tabs never loads the project code.
    const { findProject } = await import("../project");
    if (!(await session.openProject(await findProject(fs, logger, undefined, projectId)))) return;
  } catch (error) {
    await logger.error(MODULE, error, { action: "resume restored project", projectId });
    return;
  }
  // Opening the project focuses its main file; the tab the page was showing is focused again.
  const focused = tabs.find((t) => t.focused);
  const tab = focused === undefined ? null : parseTab(focused.id);
  if (tab) workspace.openTab(tab.kind, tab.params);
}
