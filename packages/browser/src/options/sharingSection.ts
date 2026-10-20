// Builds the Sharing section: whether a Cloudflare relay account is connected, with a way to the library page to change it.
import type { ILogger } from "@labshelf/core";
import { actionButton, el, settingRow, settingsSection } from "@labshelf/core/dom";
import { bx } from "../platform";
import { openBrowserRelayAccountStore } from "../relay";

const READ_FAILED = "LabShelf could not read the relay account.";

export function createSharingSection(logger: ILogger): HTMLElement {
  const store = openBrowserRelayAccountStore(logger);
  const status = el("span", { text: "Checking…" });
  const row = el("div");
  const refresh = async (): Promise<void> => {
    try {
      const account = await store.status();
      status.textContent = account ? `Cloudflare relay: connected (${new URL(account.relayUrl).host})` : "Cloudflare relay: not connected";
      row.replaceChildren(actionButton({
        label: account ? "Open the library to disconnect" : "Open the library to connect",
        icon: "library",
        onClick: () => void bx.tabs.create({ url: bx.runtime.getURL("library-page/index.html") }),
      }));
    } catch (err) {
      status.textContent = READ_FAILED;
      await logger.error("options", err, { action: "read relay account" });
    }
  };
  // The account lives in IndexedDB, which raises no change events; coming back from the library tab re-reads it.
  window.addEventListener("focus", () => void refresh());
  void refresh();
  return settingsSection(
    { title: "Sharing" },
    settingRow({ label: "Relay", description: "Shared projects and share links travel through your own Cloudflare relay, end-to-end encrypted." }, status),
    settingRow({}, row),
  );
}
