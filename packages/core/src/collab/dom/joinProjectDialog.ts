// Joins a shared project from a pasted invite link, waiting for a member to answer.
import { askInputBox, openProgressDialog, showDialog, showToast } from "../../ui/dom/index.js";
import type { JoinProjectResult, ShareHost } from "../../libraryUi/share/index.js";
import { showNoticeDialog, reportFailure } from "../../share/dom/index.js";

export function runJoinProjectDialog(host: ShareHost, invite?: string): Promise<void> {
  return reportFailure("join the shared project", async () => {
    const text = invite ?? await askInputBox({
      title: "Join Shared Project",
      prompt: "Paste the invite link a collaborator sent you",
      placeholder: "labshelf://join#…",
      validate: (v) => (v.trim() === "" ? "Paste an invite link" : null),
    });
    if (!text) return;
    const progress = openProgressDialog({
      title: "Join Shared Project",
      message: "Joining the shared project: waiting for a member to answer",
      cancellable: true,
    });
    let result: JoinProjectResult;
    try {
      result = await host.joinProject(text, progress.signal);
    } catch (error) {
      if (progress.signal.aborted) return;
      throw error;
    } finally {
      progress.close();
    }
    if (progress.signal.aborted) return;
    if (result.kind === "refused") { await showNoticeDialog("Could not join the project", result.problem, "warning"); return; }
    if (result.kind === "active") { showToast("This shared project is already connected on this device.", "info"); return; }
    const joined = result;
    const choice = await showDialog({
      title: `Joined "${joined.name}".`,
      severity: "info",
      buttons: [{ id: "open", label: "Open Project", primary: true }],
    });
    if (choice === "open") await host.openProject(joined.id);
  });
}
