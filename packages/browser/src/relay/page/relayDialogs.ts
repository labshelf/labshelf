// Asks the owner about the Cloudflare relay with the core dialog and quick pick: connect, account choice, sign in again, disconnect.
import type { CloudflareAccount } from "@labshelf/core";
import { quickPick, showDialog } from "@labshelf/core/dom";

const RELAY_PURPOSE = "LabShelf sets up a small relay in your own Cloudflare account, on the free plan. It carries every edit between "
  + "collaborators, end-to-end encrypted, and keeps them so collaborators sync even when you are offline.";

export async function confirmConnect(): Promise<boolean> {
  const answer = await showDialog({
    title: "Connect Cloudflare to give your shared projects a relay",
    message: `${RELAY_PURPOSE} LabShelf opens Cloudflare in a new tab, where you sign in and allow it to manage Workers in your account. `
      + "Keep this page open until the tab closes.",
    severity: "info",
    buttons: [{ id: "signIn", label: "Sign In with Cloudflare", primary: true }],
  });
  return answer === "signIn";
}

export async function chooseAccount(accounts: CloudflareAccount[]): Promise<string | undefined> {
  return quickPick(accounts.map((account) => ({ label: account.name, description: account.id, icon: "cloud" as const, value: account.id })), {
    title: "Connect Cloudflare", placeholder: "Account to set up the relay in",
  });
}

export async function confirmSignInAgain(): Promise<boolean> {
  const answer = await showDialog({
    title: "Sign in to Cloudflare again",
    message: "Cloudflare no longer accepts the stored sign-in. LabShelf opens Cloudflare in a new tab to sign in again.",
    severity: "info",
    buttons: [{ id: "signIn", label: "Sign In with Cloudflare", primary: true }],
  });
  return answer === "signIn";
}

/** Shows the connected relay's host and offers to disconnect it; true when the owner chooses Disconnect. */
export async function confirmDisconnect(relayUrl: string): Promise<boolean> {
  const answer = await showDialog({
    title: `Cloudflare is connected, with your relay at ${new URL(relayUrl).host}`,
    message: "Disconnecting deletes the relay from your Cloudflare account, with the encrypted edits it keeps, and takes it out of your "
      + "shared projects. Shared projects that list no other relay stop syncing until someone offers one.",
    severity: "danger",
    buttons: [{ id: "disconnect", label: "Disconnect", danger: true }],
  });
  return answer === "disconnect";
}
