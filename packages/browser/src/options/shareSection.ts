// Builds the Sharing section: whether a Cloudflare relay account is connected, with a way to the library page to change it.
import type { ILogger } from "@labshelf/core";
import { actionButton, el, settingRow, settingsSection, textField } from "@labshelf/core/dom";
import { DEFAULT_DISPLAY_NAME, loadDisplayName, saveDisplayName } from "../collab";
import { bx } from "../platform";
import { openBrowserRelayAccountStore } from "../relay";

const READ_FAILED = "LabShelf could not read the relay account.";
const NAME_FAILED = "LabShelf could not save your name.";

function displayNameRow(logger: ILogger): HTMLElement {
  const field = textField({ id: "share-display-name", type: "text", placeholder: DEFAULT_DISPLAY_NAME });
  const input = field.control;
  const error = el("span", { role: "alert" });
  let saved = "";
  const fail = async (err: unknown, action: string): Promise<void> => {
    error.textContent = NAME_FAILED;
    await logger.error("options", err, { action });
  };
  void loadDisplayName().then((name) => {
    saved = name ?? "";
    input.value = saved;
  }, (err: unknown) => fail(err, "read display name"));
  input.addEventListener("change", () => {
    const name = input.value.trim();
    // An empty name would show collaborators a blank label, so the last non-empty name stays.
    if (name === "") { input.value = saved; return; }
    error.textContent = "";
    void saveDisplayName(name).then(() => { saved = name; input.value = name; }, (err: unknown) => fail(err, "save display name"));
  });
  return settingRow(
    { label: "Your name in shared projects", description: "Collaborators see it next to your cursor and comments." },
    el("div", {}, field.element, error),
  );
}

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
        onClick: () => void bx.tabs.create({ url: bx.runtime.getURL("libraryPage/index.html") }),
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
    displayNameRow(logger),
  );
}
