// Shares a writing project through the user's relay, or shows the invite when it is already shared.
import { openProgressDialog, showDialog } from "../../ui/dom/index.js";
import type { ShareProjectResult, ShareHost } from "../../share/index.js";
import { showNoticeDialog, reportFailure } from "../../share/dom/index.js";
import { showInviteDialog } from "./inviteDialog.js";
import { runJoinProjectDialog } from "./joinProjectDialog.js";
import { pickProject } from "./pickProject.js";

const SHARE_NOTICE = "Anyone with the invite link can read and edit this project and pass the link on. There are no roles, so send it only to collaborators. Edits travel through your Cloudflare relay, end-to-end encrypted.";

export function runShareProjectDialog(host: ShareHost, projectId?: string): Promise<void> {
  return reportFailure("share the project", async () => {
    const project = await pickProject(host, projectId, false, "Share Project");
    if (!project) return;
    const status = await host.projectStatus(project.id);
    if (status.kind === "ineligible") { await showNoticeDialog(`"${project.name}" cannot be shared`, status.reason, "warning"); return; }
    if (status.kind === "shared") { await showInviteDialog(host, project.id, project.name, await host.inviteLink(project.id)); return; }
    const choice = await showDialog({
      title: `Share "${project.name}"?`,
      message: SHARE_NOTICE,
      buttons: [{ id: "share", label: "Share", primary: true }],
    });
    if (choice !== "share") return;
    const progress = openProgressDialog({ title: `Sharing "${project.name}"`, message: `Sharing "${project.name}"…`, cancellable: true });
    let result: ShareProjectResult;
    try {
      result = await host.shareProject(project.id, progress.signal);
    } catch (error) {
      if (progress.signal.aborted) return;
      throw error;
    } finally {
      progress.close();
    }
    if (progress.signal.aborted) return;
    await showResult(host, project, result);
  });
}

async function showResult(host: ShareHost, project: { id: string; name: string }, result: ShareProjectResult): Promise<void> {
  if (result.kind === "shared") { await showInviteDialog(host, project.id, project.name, result.invite); return; }
  if (result.kind === "noRelay") {
    await showNoticeDialog("Connect Cloudflare to share", "Sharing needs a Cloudflare relay: every edit travels through it, end-to-end encrypted. Connect Cloudflare to share.");
    return;
  }
  const choice = await showDialog({
    title: `"${project.name}" is shared, but its invite is not on this device. Paste it with Join Shared Project to reconnect.`,
    severity: "warning",
    buttons: [{ id: "join", label: "Join Shared Project…", primary: true }],
  });
  if (choice === "join") await runJoinProjectDialog(host);
}
