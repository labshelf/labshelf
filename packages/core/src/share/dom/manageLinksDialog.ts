// Lists the share links this host made and lets the user copy, open or revoke one.
import { progressDialog, quickPick, showDialog, toast } from "../../ui/dom/index.js";
import type { SharedLinkView, SharingHost } from "../../library-ui/sharing/index.js";
import { copiedLinkText, revokeResultText, revokeShareConfirm } from "../workflow/index.js";
import { reportingFailure } from "./reportFailure.js";

type LinkAction = "copy" | "open" | "revoke";

export function runManageLinksDialog(host: SharingHost): Promise<void> {
  return reportingFailure("manage the shared links", async () => {
    const links = await host.sharedLinks();
    if (links.length === 0) { toast(`No folder of this library is shared as a link from ${host.place}.`, "info"); return; }
    const link = await quickPick(
      links.map((l) => ({ label: l.folder, description: `${new Date(l.createdAt).toLocaleString()} · ${l.relayHost}`, icon: "link" as const, value: l })),
      { title: "Shared Links", placeholder: "Pick a shared folder" },
    );
    if (!link) return;
    const action = await quickPick<LinkAction>([
      { label: "Copy Link", icon: "copy", value: "copy" },
      { label: "Open Link", icon: "external", value: "open" },
      { label: "Revoke Link…", icon: "trash", value: "revoke" },
    ], { title: `"${link.folder}"` });
    if (action === "copy") {
      const copied = await host.copyText(link.link);
      toast(copied ? copiedLinkText(link.folder) : "The clipboard refused the copy; select the link and copy it.", copied ? "ok" : "error");
    } else if (action === "open") await host.openLink(link.link);
    else if (action === "revoke") await revoke(host, link);
  });
}

async function revoke(host: SharingHost, link: SharedLinkView): Promise<void> {
  const notice = revokeShareConfirm(link.folder);
  const choice = await showDialog({
    title: notice.message,
    message: notice.detail,
    severity: "danger",
    buttons: [{ id: "revoke", label: "Revoke Link", primary: true, danger: true }],
  });
  if (choice !== "revoke") return;
  const progress = progressDialog({ title: "Revoking link", message: `Revoking the link to "${link.folder}"…` });
  let revoked: boolean;
  try {
    revoked = await host.revokeLink(link.id);
  } finally {
    progress.close();
  }
  toast(revokeResultText(link.folder, revoked, host.place), "ok");
}
