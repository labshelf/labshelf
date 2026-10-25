// Builds the Sharing section: whether a Cloudflare relay account is connected, with a way to the library page to change it.
import type { ILogger } from "@labshelf/core";
import { renderActionButton, renderElement, renderSettingRow, renderSettingsSection, renderTextField } from "@labshelf/core/dom";
import { DEFAULT_DISPLAY_NAME, loadDisplayName, saveDisplayName } from "../collab";
import { bx } from "../platform";
import { openBrowserRelayAccountStore } from "../relay";

const READ_FAILED = "LabShelf could not read the relay account.";
const NAME_FAILED = "LabShelf could not save your name.";

function displayNameRow(logger: ILogger): HTMLElement {
  const field = renderTextField({ id: "share-display-name", type: "text", placeholder: DEFAULT_DISPLAY_NAME });
  const input = field.control;
  const error = renderElement("span", { role: "alert" });
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
  return renderSettingRow(
    { label: "Your name in shared projects", description: "Collaborators see it next to your cursor and comments." },
    renderElement("div", {}, field.element, error),
  );
}

export function createShareSection(logger: ILogger): HTMLElement {
  const store = openBrowserRelayAccountStore(logger);
  const status = renderElement("span", { text: "Checking…" });
  const row = renderElement("div");
  const refresh = async (): Promise<void> => {
    try {
      const account = await store.status();
      status.textContent = account ? `Cloudflare relay: connected (${new URL(account.relayUrl).host})` : "Cloudflare relay: not connected";
      row.replaceChildren(renderActionButton({
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
  return renderSettingsSection(
    { title: "Sharing" },
    renderSettingRow({ label: "Relay", description: "Shared projects and share links travel through your own Cloudflare relay, end-to-end encrypted." }, status),
    renderSettingRow({}, row),
    displayNameRow(logger),
  );
}
