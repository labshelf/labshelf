// Mounts the Account tab both apps open: the user name, the Cloudflare connection and the (not yet built) remote access switch.
import { renderElement } from "../../ui/dom/dom.js";
import {
  createToneLine, renderActionButton, renderCheckboxField, renderSettingRow, renderSettingsPage, renderSettingsSection, renderTextField,
} from "../../ui/dom/settings.js";
import { RELAY_PURPOSE } from "../../relay/relayAccount.js";
import type { AccountPort, AccountState } from "../account.js";

function relayHost(relayUrl: string): string {
  try { return new URL(relayUrl).host; } catch { return relayUrl; }
}

export function mountAccountView(root: HTMLElement, port: AccountPort): { dispose(): void } {
  const name = renderTextField({ id: "account-user-name", type: "text", placeholder: "Your name" });
  const save = renderActionButton({
    label: "Save", icon: "check", primary: true,
    onClick: async () => {
      const trimmed = name.control.value.trim();
      if (trimmed !== "") await port.saveUserName(trimmed);
    },
  });
  name.control.addEventListener("keydown", (event) => { if (event.key === "Enter") save.click(); });
  const nameSection = renderSettingsSection(
    { title: "User name", description: "The name your collaborators see beside your edits, comments and cursor." },
    renderSettingRow({ label: "User name", labelFor: name.control.id }, renderElement("div", { class: "settings-actions account-name" }, name.element, save)),
  );

  const status = createToneLine();
  const connect = renderActionButton({ label: "Connect", icon: "cloud", primary: true, onClick: () => port.connectCloudflare() });
  const disconnect = renderActionButton({ label: "Disconnect", icon: "x", onClick: () => port.disconnectCloudflare() });
  const soon = renderElement("p", { class: "settings-desc", text: "Coming soon: this app cannot connect Cloudflare yet." });
  const cloudflareSection = renderSettingsSection(
    { title: "Cloudflare", description: RELAY_PURPOSE },
    status.element, renderElement("div", { class: "settings-actions" }, connect, disconnect), soon,
  );

  const remote = renderCheckboxField({ id: "account-remote-access", label: "Remote access" });
  remote.control.setAttribute("role", "switch");
  remote.control.disabled = true;
  const remoteSection = renderSettingsSection(
    { title: "Remote access" },
    renderSettingRow({ description: "Coming soon: open your library from any browser" }, remote.element),
  );

  root.append(renderSettingsPage({ title: "Account" }, nameSection, cloudflareSection, remoteSection));

  let shownName: string | undefined;
  const show = (state: AccountState): void => {
    // A name the user is still typing is kept; only a field that still shows the last stored name follows the store.
    if (shownName === undefined || name.control.value === shownName) name.control.value = state.userName;
    shownName = state.userName;
    if (state.relayUrl) status.set(`Connected, with your relay at ${relayHost(state.relayUrl)}`, "ok");
    else status.set("Not connected", "idle");
    connect.hidden = state.relayUrl !== undefined;
    disconnect.hidden = state.relayUrl === undefined;
    connect.disabled = !state.cloudflareAvailable;
    disconnect.disabled = !state.cloudflareAvailable;
    soon.hidden = state.cloudflareAvailable;
  };
  const stop = port.watch(show);
  return { dispose: () => { stop(); root.replaceChildren(); } };
}
