// Moves a source tab between running a share and observing it: the "Use here" takeover and the remount when another tab takes it over.
import { showToast } from "@labshelf/core/dom";
import type { ProjectEntry } from "@labshelf/core";
import type { TabContext } from "../../libraryUi/editorArea";
import type { SourceFileMode } from "./sharedFile";

const MODULE = "tabs.source";

interface TabFile { projectId: string; path: string }

export async function takeSharedProjectHere(
  { logger, project }: TabContext, { projectId, path }: TabFile, observing: SourceFileMode, reopen: () => Promise<void>,
): Promise<void> {
  if (observing.kind !== "observing") return;
  void logger.log("INFO", MODULE, "taking a shared project over from another tab", { projectId, path, shareId: observing.shareId });
  // The share's state change remounts this tab once the takeover connects.
  await project().sharing.shares.takeOver(observing.shareId).catch((error: unknown) => {
    void logger.error(MODULE, error, { action: "take a shared project over from another tab", projectId, path, shareId: observing.shareId });
    showToast("Could not use the shared project here. Try again, or close the other tab.", "error");
    void reopen();
  });
}

/** A takeover in either direction flips the tab between running the share and observing it, so `remount` runs; returns the function that stops watching. */
export function remountOnTakeover(
  { project }: TabContext, current: () => { loaded: ProjectEntry | undefined; mode: SourceFileMode | undefined; disposed: boolean }, remount: () => void,
): () => void {
  return project().sharing.shares.onChange(() => {
    const { loaded, mode, disposed } = current();
    const shareId = loaded?.kind === "ready" ? loaded.settings.shared : mode?.kind === "observing" ? mode.shareId : undefined;
    if (shareId === undefined || disposed) return;
    const connected = project().sharing.shares.state(shareId)?.kind === "connected";
    if (connected !== (mode?.kind === "shared")) remount();
  });
}
