// Mounts the Account tab both apps open: the user name, the Cloudflare connection and the remote access switch with its store.
import {
  createToneLine, renderElement, renderActionButton, renderCheckboxField, renderNumberField, renderSettingRow, renderSettingsPage, renderSettingsSection,
  renderTextField,
} from "../../ui/dom/index.js";
import { RELAY_PURPOSE } from "../../relay/index.js";
import type { AccountPort, AccountRemoteDetails, AccountState } from "../account.js";

const GB = 1_000_000_000;
const MB = 1_000_000;
/** Past this many entries the left-out list starts collapsed behind its count. */
const LEFT_OUT_OPEN_MAX = 10;
const MOVE_TO_R2_HINT = "Create an R2 bucket named labshelf-mirror in your Cloudflare dashboard (R2 needs a card on file), then choose Move to R2.";

function relayHost(relayUrl: string): string {
  try { return new URL(relayUrl).host; } catch { return relayUrl; }
}

/** Words a store size in GB from 1 GB up, else in MB, with at most one decimal. */
function formatStoreSize(bytes: number): string {
  return bytes >= GB ? `${Number((bytes / GB).toFixed(1))} GB` : `${Number((bytes / MB).toFixed(1))} MB`;
}

function fullMessage(details: AccountRemoteDetails): string {
  return details.store === "do"
    ? "Your 5 GB are full. To store more, move to R2 (needs a card on your Cloudflare account)."
    : `Your limit of ${formatStoreSize(details.limit)} is reached. Raise it to keep sending.`;
}

/** A switch: a checkbox with the switch role, acting on click (a click already carries the new value, and a detached control fires no change event). */
function renderSwitch(id: string, label: string, onClick: (checked: boolean) => void): ReturnType<typeof renderCheckboxField> {
  const field = renderCheckboxField({ id, label });
  field.control.setAttribute("role", "switch");
  field.control.addEventListener("click", () => { onClick(field.control.checked); });
  return field;
}

/** A line of text the view shows only when it has something to say. */
function renderNote(className: string, alert = false): { element: HTMLElement; set(text: string | undefined): void } {
  const element = renderElement("p", { class: className, text: "" });
  if (alert) element.setAttribute("role", "alert");
  element.hidden = true;
  return { element, set: (text) => { element.textContent = text ?? ""; element.hidden = !text; } };
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
    renderSettingRow({ label: "User name", labelFor: name.control.id }, renderElement("div", { class: "settings-actions account-inline" }, name.element, save)),
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
    const who = state.cloudflareEmail ? ` as ${state.cloudflareEmail}` : "";
    if (state.relayUrl) status.set(`Connected${who}, with your relay at ${relayHost(state.relayUrl)}`, "ok");
    else status.set("Not connected", "idle");
    connect.hidden = state.relayUrl !== undefined;
    disconnect.hidden = state.relayUrl === undefined;
    connect.disabled = !state.cloudflareAvailable;
    disconnect.disabled = !state.cloudflareAvailable;
    soon.hidden = state.cloudflareAvailable;
  };
  return { element: cloudflareSection, show };
}

/** The left-out list of the last sync, collapsed behind its count once it is long. */
function renderLeftOut(): { element: HTMLElement; show(paths: readonly string[]): void } {
  const count = renderElement("summary", { text: "" });
  const list = renderElement("ul", { class: "account-left-out-list" });
  const element = renderElement("details", { class: "account-left-out" }, count, list);
  let shown = "";
  return {
    element,
    show(paths) {
      element.hidden = paths.length === 0;
      const key = paths.join("\n");
      if (key === shown) return;
      shown = key;
      count.textContent = `Left out (${paths.length})`;
      list.replaceChildren(...paths.map((path) => renderElement("li", { text: path })));
      element.open = paths.length <= LEFT_OUT_OPEN_MAX;
    },
  };
}

/**
 * The store of a remote library that is on: where it is and how full, what the last sync left out, the limit,
 * the paper PDFs switch (asked first with their size) and the move between Durable Object and R2.
 */
function renderStoreDetails(port: AccountPort): AccountSection {
  const store = renderElement("p", { class: "settings-desc", text: "" });
  const usage = createToneLine();
  const warning = renderNote("account-warning", true);
  const full = renderNote("account-full", true);
  const leftOut = renderLeftOut();

  const limit = renderNumberField({ id: "account-store-limit", min: 0, max: 10_000, step: 0.1, width: "sm" });
  limit.control.placeholder = "Default";
  const saveLimit = renderActionButton({
    label: "Save", icon: "check",
    onClick: async () => {
      const text = limit.control.value.trim();
      const gb = Number(text);
      if (text === "") await port.setStorageLimit(null);
      else if (gb > 0) await port.setStorageLimit(Math.round(gb * GB));
    },
  });

  const question = renderElement("span", { text: "" });
  const include = renderActionButton({ label: "Include", icon: "check", primary: true, onClick: () => { confirm.hidden = true; return port.setIncludePdfs(true); } });
  const cancel = renderActionButton({ label: "Cancel", icon: "x", onClick: async () => { confirm.hidden = true; } });
  const confirm = renderElement("div", { class: "settings-actions account-inline" }, question, include, cancel);
  confirm.hidden = true;
  const estimateMessage = renderNote("settings-desc account-error", true);
  let busy = false;
  let estimating = false;
  const askToIncludePdfs = async (): Promise<void> => {
    estimating = true;
    estimateMessage.set(undefined);
    syncDisabled();
    try {
      const { bytes } = await port.estimatePaperPdfs();
      question.textContent = `Paper PDFs will use about ${formatStoreSize(bytes)}. Include them?`;
      confirm.hidden = false;
    } catch (error) {
      estimateMessage.set(error instanceof Error ? error.message : String(error));
    } finally {
      estimating = false;
      syncDisabled();
    }
  };
  const pdfs = renderSwitch("account-include-pdfs", "Include paper PDFs", (checked) => {
    if (!checked) { void port.setIncludePdfs(false); return; }
    // The switch turns on only once the user has seen the size and chosen Include.
    pdfs.control.checked = false;
    void askToIncludePdfs();
  });

  const moveHint = renderElement("p", { class: "settings-desc", text: MOVE_TO_R2_HINT });
  const toR2 = renderActionButton({ label: "Move to R2", icon: "cloud", onClick: () => port.moveStore("r2") });
  const toDurableObject = renderActionButton({ label: "Move to Durable Object", icon: "cloud", onClick: () => port.moveStore("do") });

  const controls = [limit.control, saveLimit, pdfs.control, include, cancel, toR2, toDurableObject];
  function syncDisabled(): void { for (const control of controls) control.disabled = busy || estimating; }

  const element = renderElement("div", { class: "account-store" },
    store, usage.element, warning.element, full.element, leftOut.element,
    renderSettingRow(
      { label: "Limit (GB)", labelFor: limit.control.id, description: "Leave empty for the store's default." },
      renderElement("div", { class: "settings-actions account-inline" }, limit.element, saveLimit),
    ),
    renderSettingRow({ description: "Send the PDFs of your papers too, so they open from labshelf.org/open/." }, pdfs.element),
    confirm, estimateMessage.element,
    moveHint, renderElement("div", { class: "settings-actions" }, toR2, toDurableObject),
  );
  let shownLimit: string | undefined;
  const show = (state: AccountState): void => {
    const details = state.remoteAccess.on ? state.remoteAccess.details : undefined;
    element.hidden = details === undefined;
    busy = state.remoteAccess.busy;
    syncDisabled();
    if (!details) return;
    store.textContent = details.store === "do" ? "Stored in: Durable Object, free" : "Stored in: R2";
    usage.set(`${formatStoreSize(details.used)} of ${formatStoreSize(details.limit)} used`, details.full ? "error" : "ok");
    warning.set(details.warn && !details.full ? "Your remote library is almost full" : undefined);
    full.set(details.full ? fullMessage(details) : undefined);
    leftOut.show(details.leftOut);
    // A limit the user is still typing is kept, like the user name.
    const limitText = String(Number((details.limit / GB).toFixed(1)));
    if (shownLimit === undefined || limit.control.value === shownLimit) limit.control.value = limitText;
    shownLimit = limitText;
    pdfs.control.checked = details.includePdfs;
    if (details.includePdfs) confirm.hidden = true;
    moveHint.hidden = toR2.hidden = details.store !== "do";
    toDurableObject.hidden = details.store !== "r2";
  };
  return { element, show };
}

/** The Remote access section: the switch, a hint while Cloudflare is not connected, the last failure and, while on, the store. */
function renderRemoteSection(port: AccountPort): AccountSection {
  const remote = renderSwitch("account-remote-access", "Remote access", (checked) => { void port.setRemoteAccess(checked); });
  const remoteHint = renderNote("settings-desc");
  const remoteMessage = renderNote("settings-desc account-error", true);
  const details = renderStoreDetails(port);
  const remoteSection = renderSettingsSection(
    { title: "Remote access" },
    renderSettingRow(
      { description: "Open your library read-only from labshelf.org/open/ after signing in with this Cloudflare account." },
      remote.element,
    ),
    remoteHint.element, remoteMessage.element, details.element,
  );
  const show = (state: AccountState): void => {
    const access = state.remoteAccess;
    remote.control.checked = access.on;
    remote.control.disabled = !access.available || access.busy;
    remoteHint.set(state.cloudflareAvailable && state.relayUrl === undefined ? "Connect Cloudflare first" : undefined);
    remoteMessage.set(access.message);
    details.show(state);
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
