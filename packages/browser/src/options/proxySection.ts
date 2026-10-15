// Builds the Library proxies section: an ordered list of proxies, each with a name, an address, an enabled switch and a remove button.
import type { LibraryProxy } from "@labshelf/core";
import { actionButton, checkboxField, el, inlineCode, settingsSection, textField } from "@labshelf/core/dom";
import { judgeTemplate, savableProxies } from "./proxyRows";

export interface ProxySection {
  element: HTMLElement;
  /** The rows that can be saved, in list order. */
  read(): LibraryProxy[];
  fill(proxies: readonly LibraryProxy[]): void;
}

const DESCRIPTION = [
  "When a publisher asks for a sign-in, LabShelf retries through each enabled proxy, top to bottom. Three address shapes work: ",
  "a prefix such as ", inlineCode("https://login.ezproxy.uni.edu/login?url=$@"),
  ", a hostname such as ", inlineCode(".ezproxy.uni.edu"),
  " and an OpenAthens redirector such as ", inlineCode("https://go.openathens.net/redirector/uni.edu"), ".",
];

let rowSeq = 0;

function createRow(proxy: LibraryProxy, onRemove: (row: HTMLElement) => void): HTMLElement {
  const id = `proxy-${++rowSeq}`;
  const name = textField({ id: `${id}-name`, type: "text", placeholder: "Library name" });
  const template = textField({ id: `${id}-template`, type: "text", placeholder: "https://login.ezproxy.uni.edu/login?url=$@" });
  const enabled = checkboxField({ id: `${id}-enabled`, label: "Enabled", checked: proxy.enabled });
  const status = el("span", { id: `${id}-status`, class: "proxy-status", "aria-live": "polite" });
  const remove = actionButton({ label: "Remove", icon: "trash", onClick: () => onRemove(row) });
  name.control.setAttribute("aria-label", "Proxy name");
  template.control.setAttribute("aria-label", "Proxy address");
  name.control.value = proxy.name;
  template.control.value = proxy.template;
  template.control.setAttribute("aria-describedby", status.id);
  const row = el("div", { class: "proxy-row", role: "group" }, name.element, template.element, enabled.element, remove, status);
  row.addEventListener("input", () => showVerdict(template.control, status));
  showVerdict(template.control, status);
  return row;
}

function showVerdict(template: HTMLInputElement, status: HTMLElement): void {
  const verdict = judgeTemplate(template.value);
  status.textContent = !verdict ? "" : "error" in verdict ? verdict.error : verdict.label;
  status.classList.toggle("proxy-status-error", verdict !== undefined && "error" in verdict);
  template.setAttribute("aria-invalid", String(verdict !== undefined && "error" in verdict));
}

export function createProxySection(onChange: () => void): ProxySection {
  const list = el("div", { class: "proxy-list" });
  const labelRows = (): void => {
    [...list.children].forEach((row, i) => row.setAttribute("aria-label", `Proxy ${i + 1}`));
  };
  const add = (proxy: LibraryProxy): void => { list.append(createRow(proxy, remove)); labelRows(); };
  const remove = (row: HTMLElement): void => { row.remove(); labelRows(); onChange(); };
  list.addEventListener("input", onChange);
  list.addEventListener("change", onChange);

  const addButton = actionButton({ label: "Add proxy", icon: "plus", onClick: () => add({ name: "", template: "", enabled: true }) });
  const element = settingsSection({ title: "Library proxies", description: DESCRIPTION }, list, el("div", { class: "settings-actions" }, addButton));
  return {
    element,
    read: () => savableProxies([...list.children].map((row) => ({
      name: row.querySelector<HTMLInputElement>("input[id$='-name']")!.value,
      template: row.querySelector<HTMLInputElement>("input[id$='-template']")!.value,
      enabled: row.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked,
    }))),
    fill(proxies) {
      list.replaceChildren();
      proxies.forEach(add);
    },
  };
}
