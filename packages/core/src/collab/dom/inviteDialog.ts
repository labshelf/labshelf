// Shows a shared project's invite link with its copy and stop-sharing actions.
import { showDialog, toast } from "../../ui/dom/index.js";
import type { SharingHost } from "../../library-ui/sharing/index.js";
import { reportingFailure } from "../../share/dom/index.js";
import { runLeaveProjectDialog } from "./leaveProjectDialog.js";

const COPY_REFUSED_TEXT = "The clipboard refused the copy; select the link and copy it.";

/** Copies the invite for a project and tells the user how it went; true when the clipboard took it. */
export async function copyInvite(host: SharingHost, name: string, invite: string): Promise<boolean> {
  const copied = await host.copyText(invite);
  toast(copied ? `Copied the invite link for "${name}".` : COPY_REFUSED_TEXT, copied ? "ok" : "error");
  return copied;
}

/** Keeps the dialog (and so the text) on screen until the copy works or the user moves on. */
export function showInviteDialog(host: SharingHost, projectId: string, name: string, invite: string): Promise<void> {
  return reportingFailure("show the invite link", async () => {
    for (;;) {
      const choice = await showDialog({
        title: `Invite link for "${name}"`,
        message: `${invite}\n\nAnyone with it can read and edit the project.`,
        severity: "info",
        buttons: [
          { id: "leave", label: "Stop Sharing on This Device…", danger: true },
          { id: "copy", label: "Copy Invite Link", primary: true },
        ],
      });
      if (choice === "leave") { await runLeaveProjectDialog(host, projectId); return; }
      if (choice !== "copy" || await copyInvite(host, name, invite)) return;
    }
  });
}
