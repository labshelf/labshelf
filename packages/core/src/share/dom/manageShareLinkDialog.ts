// Lists the share links this host made and lets the user copy, open or revoke one.
import { openProgressDialog, pickQuickEntry, showDialog, showToast } from "../../ui/dom/index.js";
import type { ShareLinkView, ShareHost } from "../../libraryUi/share/index.js";
import { describeCopiedShareLink, describeRevokeShareOutcome, describeRevokeShareNotice } from "../flow/index.js";
import { reportFailure } from "./reportFailure.js";

type LinkAction = "copy" | "open" | "revoke";

export function runManageShareLinksDialog(host: ShareHost): Promise<void> {
  return reportFailure("manage the shared links", async () => {
    const links = await host.sharedLinks();
    if (links.length === 0) { showToast(`No folder of this library is shared as a link from ${host.place}.`, "info"); return; }
    const link = await pickQuickEntry(
      links.map((l) => ({ label: l.folder, description: `${new Date(l.createdAt).toLocaleString()} · ${l.relayHost}`, icon: "link" as const, value: l })),
      { title: "Shared Links", placeholder: "Pick a shared folder" },
    );
    if (!link) return;
    const action = await pickQuickEntry<LinkAction>([
      { label: "Copy Link", icon: "copy", value: "copy" },
      { label: "Open Link", icon: "external", value: "open" },
      { label: "Revoke Link…", icon: "trash", value: "revoke" },
    ], { title: `"${link.folder}"` });
    if (action === "copy") {
      const copied = await host.copyText(link.link);
      showToast(copied ? describeCopiedShareLink(link.folder) : "The clipboard refused the copy; select the link and copy it.", copied ? "ok" : "error");
    } else if (action === "open") await host.openLink(link.link);
    else if (action === "revoke") await revoke(host, link);
  });
}

async function revoke(host: ShareHost, link: ShareLinkView): Promise<void> {
  const notice = describeRevokeShareNotice(link.folder);
  const choice = await showDialog({
    title: notice.message,
    message: notice.detail,
    severity: "danger",
    buttons: [{ id: "revoke", label: "Revoke Link", primary: true, danger: true }],
  });
  if (choice !== "revoke") return;
  const progress = openProgressDialog({ title: "Revoking link", message: `Revoking the link to "${link.folder}"…` });
  let revoked: boolean;
  try {
    revoked = await host.revokeLink(link.id);
  } finally {
    progress.close();
  }
  showToast(describeRevokeShareOutcome(link.folder, revoked, host.place), "ok");
}
