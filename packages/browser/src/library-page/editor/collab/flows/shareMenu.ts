// Builds the sharing entries of a project's menu: Share Project for an unshared one, Copy Invite Link and Stop Sharing for a shared one.
import type { MenuEntry } from "@labshelf/core/dom";
import { runLeaveDialog } from "./leaveDialog";
import { runShareDialog, type ReadyProject, type ShareDialogContext } from "./shareDialog";

export function shareMenuEntries(context: ShareDialogContext, project: ReadyProject): MenuEntry[] {
  const shareId = project.settings.shared;
  if (project.settings.trashed) { return []; }
  if (shareId === undefined) { return [{ label: "Share Project…", icon: "link", onSelect: () => void runShareDialog(context, project) }]; }
  return [
    { label: "Copy Invite Link", icon: "copy", onSelect: () => void runShareDialog(context, project) },
    { label: "Stop Sharing on This Device…", icon: "cloud-off", onSelect: () => void runLeaveDialog(context, project, shareId) },
  ];
}
