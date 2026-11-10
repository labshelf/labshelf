// Mounts the Account tab both apps open: the user name, the Cloudflare connection and the remote access switch.
import {
  createToneLine, renderElement, renderActionButton, renderCheckboxField, renderSettingRow, renderSettingsPage, renderSettingsSection, renderTextField,
} from "../../ui/dom/index.js";
import { RELAY_PURPOSE } from "../../relay/index.js";
import type { AccountPort, AccountState } from "../account.js";

function relayHost(relayUrl: string): string {
  try { return new URL(relayUrl).host; } catch { return relayUrl; }
}

/** One section of the tab: its element and the function that shows a state in it. */
interface AccountSection { element: HTMLElement; show(state: AccountState): void }

/** The user name section: a field and a Save button. */
function renderNameSection(port: AccountPort): AccountSection {
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
  let shownName: string | undefined;
  const show = (state: AccountState): void => {
    // A name the user is still typing is kept; only a field that still shows the last stored name follows the store.
    if (shownName === undefined || name.control.value === shownName) name.control.value = state.userName;
    shownName = state.userName;
  };
  return { element: nameSection, show };
}

/** The Cloudflare section: the connection status and the Connect and Disconnect buttons. */
function renderCloudflareSection(port: AccountPort): AccountSection {
  const status = createToneLine();
  const connect = renderActionButton({ label: "Connect", icon: "cloud", primary: true, onClick: () => port.connectCloudflare() });
  const disconnect = renderActionButton({ label: "Disconnect", icon: "x", onClick: () => port.disconnectCloudflare() });
  const soon = renderElement("p", { class: "settings-desc", text: "Coming soon: this app cannot connect Cloudflare yet." });
  const cloudflareSection = renderSettingsSection(
    { title: "Cloudflare", description: RELAY_PURPOSE },
    status.element, renderElement("div", { class: "settings-actions" }, connect, disconnect), soon,
  );
  const show = (state: AccountState): void => {
    if (state.relayUrl) status.set(`Connected, with your relay at ${relayHost(state.relayUrl)}`, "ok");
    else status.set("Not connected", "idle");
    connect.hidden = state.relayUrl !== undefined;
    disconnect.hidden = state.relayUrl === undefined;
    connect.disabled = !state.cloudflareAvailable;
    disconnect.disabled = !state.cloudflareAvailable;
    soon.hidden = state.cloudflareAvailable;
  };
  return { element: cloudflareSection, show };
}

/** The Remote access section: the switch, a hint while Cloudflare is not connected and the last failure. */
function renderRemoteSection(port: AccountPort): AccountSection {
  const remote = renderCheckboxField({ id: "account-remote-access", label: "Remote access" });
  remote.control.setAttribute("role", "switch");
  // "click", not "change": a click already carries the new checked value, and a detached control fires no change event.
  remote.control.addEventListener("click", () => { void port.setRemoteAccess(remote.control.checked); });
  const remoteHint = renderElement("p", { class: "settings-desc", text: "" });
  const remoteMessage = renderElement("p", { class: "settings-desc", text: "" });
  remoteMessage.setAttribute("role", "alert");
  const remoteSection = renderSettingsSection(
    { title: "Remote access" },
    renderSettingRow(
      { description: "Open your library read-only from labshelf.org/open/ after signing in with this Cloudflare account." },
      remote.element,
    ),
    remoteHint, remoteMessage,
  );
  const show = (state: AccountState): void => {
    const access = state.remoteAccess;
    remote.control.checked = access.on;
    remote.control.disabled = !access.available || access.busy;
    const needsCloudflare = state.cloudflareAvailable && state.relayUrl === undefined;
    remoteHint.textContent = needsCloudflare ? "Connect Cloudflare first" : "";
    remoteHint.hidden = !needsCloudflare;
    remoteMessage.textContent = access.message ?? "";
    remoteMessage.hidden = access.message === undefined;
  };
  return { element: remoteSection, show };
}

export function mountAccountView(root: HTMLElement, port: AccountPort): { dispose(): void } {
  const sections = [renderNameSection(port), renderCloudflareSection(port), renderRemoteSection(port)];
  root.append(renderSettingsPage({ title: "Account" }, ...sections.map((section) => section.element)));
  const show = (state: AccountState): void => { for (const section of sections) section.show(state); };
  const stop = port.watch(show);
  return { dispose: () => { stop(); root.replaceChildren(); } };
}
