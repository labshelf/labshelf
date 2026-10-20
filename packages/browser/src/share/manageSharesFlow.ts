// Lists the shares this browser made of the library's folders, newest first, and copies, opens or revokes the link picked.
import { loadShareRegistry, relayBackendFor, revokeShare, revokeShareConfirm, shareRecordLink, type ShareRecord } from "@labshelf/core";
import { quickPick, showDialog } from "@labshelf/core/dom";
import { openLinkInTab, reportShareFailure, type ShareLinkPage } from "./shareLinkPage";

type Action = "copy" | "open" | "revoke";

function pickShare(shares: readonly ShareRecord[]): Promise<ShareRecord | undefined> {
  const items = [...shares].reverse().map((share) => ({
    label: share.folder, description: `${new Date(share.createdAt).toLocaleString()} · ${new URL(share.relayUrl).host}`, icon: "link" as const, value: share,
  }));
  return quickPick(items, { title: "Manage Shared Links", placeholder: "Shared link to manage" });
}

function pickAction(share: ShareRecord): Promise<Action | undefined> {
  return quickPick<Action>([
    { label: "Copy Link", icon: "copy", value: "copy" },
    { label: "Open Link", icon: "external", value: "open" },
    { label: "Revoke Link…", description: "anyone who has it can no longer open it", icon: "trash", value: "revoke" },
  ], { title: `Link to "${share.folder}"` });
}

async function revoke(page: ShareLinkPage, share: ShareRecord): Promise<void> {
  const confirm = revokeShareConfirm(share.folder);
  const answer = await showDialog({ title: confirm.message, message: confirm.detail, severity: "danger", buttons: [{ id: "revoke", label: "Revoke", danger: true }] });
  if (answer !== "revoke") return;
  const backendFor = relayBackendFor(await page.relay.connectedRelay());
  page.progress(`Revoking the link to "${share.folder}"…`);
  let revoked: boolean;
  try {
    revoked = await revokeShare(share.id, { registry: page.registry, backendFor, logger: page.logger });
  } finally {
    page.progress(null);
  }
  page.notice(revoked ? "ok" : "info", revoked ? `Revoked the link to "${share.folder}".` : `The link to "${share.folder}" is no longer listed in this browser.`);
}

export async function manageSharesFlow(page: ShareLinkPage): Promise<void> {
  let picked: ShareRecord | undefined;
  try {
    const { shares } = await loadShareRegistry(page.registry);
    if (shares.length === 0) { page.notice("info", "This browser has shared no folder of this library as a link."); return; }
    picked = await pickShare(shares);
    const action = picked && (await pickAction(picked));
    if (!picked || !action) return;
    if (action === "copy") {
      await navigator.clipboard.writeText(shareRecordLink(picked));
      page.notice("ok", `Copied the link to "${picked.folder}".`);
    } else if (action === "open") {
      openLinkInTab(shareRecordLink(picked));
    } else {
      await revoke(page, picked);
    }
  } catch (error) {
    reportShareFailure(page, picked ? `manage the link to "${picked.folder}"` : "read this browser's shared links", error, { shareId: picked?.id });
  }
}
