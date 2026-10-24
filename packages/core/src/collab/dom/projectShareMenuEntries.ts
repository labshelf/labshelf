// Builds the share entries of a project's context menu from what the host offers.
import type { MenuEntry } from "../../ui/dom/index.js";
import type { SharingHost } from "../../libraryUi/sharing/index.js";
import { reportingFailure } from "../../share/dom/index.js";
import { copyInvite, showInviteDialog } from "./inviteDialog.js";
import { runLeaveProjectDialog } from "./leaveProjectDialog.js";
import { runShareProjectDialog } from "./shareProjectDialog.js";

export function projectShareMenuEntries(host: SharingHost, project: { id: string; shared: boolean }): MenuEntry[] {
  if (!host.offers().projects) return [];
  if (!project.shared) return [{ label: "Share Project…", icon: "link", onSelect: () => void runShareProjectDialog(host, project.id) }];
  const withInvite = (action: string, use: (name: string, invite: string) => Promise<unknown>) => () => void reportingFailure(action, async () => {
    const name = (await host.projects()).find((p) => p.id === project.id)?.name ?? "the project";
    await use(name, await host.inviteLink(project.id));
  });
  return [
    { label: "Copy Invite Link", icon: "copy", onSelect: withInvite("copy the invite link", (name, invite) => copyInvite(host, name, invite)) },
    { label: "Share Details…", icon: "link", onSelect: withInvite("show the invite link", (name, invite) => showInviteDialog(host, project.id, name, invite)) },
    { label: "Stop Sharing on This Device…", icon: "trash", danger: true, onSelect: () => void runLeaveProjectDialog(host, project.id) },
  ];
}
