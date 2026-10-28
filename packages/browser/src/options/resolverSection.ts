// Builds the editable-list settings section (rows of name, address, enabled switch and remove button) and its two uses: Library proxies and Custom resolvers.
import { renderActionButton, renderCheckboxField, renderElement, renderSettingsSection, renderTextField, renderInlineCode } from "@labshelf/core/dom";
import { deriveProxyKind, type LibraryProxy, type ProxyKind, isCustomResolverTemplate, type CustomResolver } from "@labshelf/core";

interface EditableRow {
  name: string;
  template: string;
  enabled: boolean;
}

/** What to show beside an address field. */
interface RowVerdict {
  text: string;
  isError: boolean;
}

export interface EditableListSpec {
  title: string;
  description: (string | Node)[];
  /** Prefix of the row element ids. */
  idPrefix: string;
  /** Singular label of one row, used for the row's accessible name, "<label> <n>". */
  rowLabel: string;
  addLabel: string;
  namePlaceholder: string;
  nameAriaLabel: string;
  addressPlaceholder: string;
  addressAriaLabel: string;
  judge(template: string): RowVerdict | undefined;
  /** Keeps the rows that can be saved, in list order. */
  savable(rows: readonly EditableRow[]): EditableRow[];
}

export interface EditableListSection {
  element: HTMLElement;
  /** The rows that can be saved, in list order. */
  read(): EditableRow[];
  fill(rows: readonly EditableRow[]): void;
}

let rowSeq = 0;

function showVerdict(template: HTMLInputElement, status: HTMLElement, verdict: RowVerdict | undefined): void {
  status.textContent = verdict?.text ?? "";
  status.classList.toggle("editable-status-error", verdict?.isError === true);
  template.setAttribute("aria-invalid", String(verdict?.isError === true));
}

function createRow(spec: EditableListSpec, value: EditableRow, onRemove: (row: HTMLElement) => void): HTMLElement {
  const id = `${spec.idPrefix}-${++rowSeq}`;
  const name = renderTextField({ id: `${id}-name`, type: "text", placeholder: spec.namePlaceholder });
  const template = renderTextField({ id: `${id}-template`, type: "text", placeholder: spec.addressPlaceholder });
  const enabled = renderCheckboxField({ id: `${id}-enabled`, label: "Enabled", checked: value.enabled });
  const status = renderElement("span", { id: `${id}-status`, class: "editable-status", "aria-live": "polite" });
  const remove = renderActionButton({ label: "Remove", icon: "trash", onClick: () => onRemove(row) });
  name.control.setAttribute("aria-label", spec.nameAriaLabel);
  template.control.setAttribute("aria-label", spec.addressAriaLabel);
  name.control.value = value.name;
  template.control.value = value.template;
  template.control.setAttribute("aria-describedby", status.id);
  const row = renderElement("div", { class: "editable-row", role: "group" }, name.element, template.element, enabled.element, remove, status);
  const refresh = (): void => showVerdict(template.control, status, spec.judge(template.control.value));
  row.addEventListener("input", refresh);
  refresh();
  return row;
}

export function createEditableListSection(spec: EditableListSpec, onChange: () => void): EditableListSection {
  const list = renderElement("div", { class: "editable-list" });
  const labelRows = (): void => {
    [...list.children].forEach((row, i) => row.setAttribute("aria-label", `${spec.rowLabel} ${i + 1}`));
  };
  const add = (value: EditableRow): void => { list.append(createRow(spec, value, remove)); labelRows(); };
  const remove = (row: HTMLElement): void => { row.remove(); labelRows(); onChange(); };
  list.addEventListener("input", onChange);
  list.addEventListener("change", onChange);

  const addButton = renderActionButton({ label: spec.addLabel, icon: "plus", onClick: () => add({ name: "", template: "", enabled: true }) });
  const element = renderSettingsSection({ title: spec.title, description: spec.description }, list, renderElement("div", { class: "settings-actions" }, addButton));
  return {
    element,
    read: () => spec.savable([...list.children].map((row) => ({
      name: row.querySelector<HTMLInputElement>("input[id$='-name']")!.value,
      template: row.querySelector<HTMLInputElement>("input[id$='-template']")!.value,
      enabled: row.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked,
    }))),
    fill(rows) {
      list.replaceChildren();
      rows.forEach(add);
    },
  };
}

const PROXY_KIND_LABELS: Record<ProxyKind, string> = { prefix: "Prefix", hostname: "Hostname", openathens: "OpenAthens" };

export const PROXY_TEMPLATE_ERROR = "Not a proxy address — paste a URL with $@, a hostname like .ezproxy.uni.edu, or an OpenAthens redirector link.";

/** What to show beside a template field: its kind, an error, or nothing while the field is empty. */
type TemplateVerdict = { kind: ProxyKind; label: string } | { error: string } | undefined;

export function checkTemplate(template: string): TemplateVerdict {
  if (!template.trim()) return undefined;
  const kind = deriveProxyKind(template);
  return kind ? { kind, label: PROXY_KIND_LABELS[kind] } : { error: PROXY_TEMPLATE_ERROR };
}

/** The rows with a valid template, trimmed and in order; a blank name falls back to the template so every proxy is nameable in logs. */
export function listWritableProxies(rows: readonly LibraryProxy[]): LibraryProxy[] {
  return rows.flatMap((row) => {
    const template = row.template.trim();
    return deriveProxyKind(template) ? [{ name: row.name.trim() || template, template, enabled: row.enabled }] : [];
  });
}

const PROXY_DESCRIPTION = [
  "When a publisher asks for a sign-in, LabShelf retries through each enabled proxy, top to bottom. Three address shapes work: ",
  "a prefix such as ", renderInlineCode("https://login.ezproxy.uni.edu/login?url=$@"),
  ", a hostname such as ", renderInlineCode(".ezproxy.uni.edu"),
  " and an OpenAthens redirector such as ", renderInlineCode("https://go.openathens.net/redirector/uni.edu"), ".",
];

export function createProxySection(onChange: () => void): EditableListSection {
  return createEditableListSection({
    title: "Library proxies",
    description: PROXY_DESCRIPTION,
    idPrefix: "proxy",
    rowLabel: "Proxy",
    addLabel: "Add proxy",
    namePlaceholder: "Library name",
    nameAriaLabel: "Proxy name",
    addressPlaceholder: "https://login.ezproxy.uni.edu/login?url=$@",
    addressAriaLabel: "Proxy address",
    judge(template) {
      const verdict = checkTemplate(template);
      if (!verdict) return undefined;
      return "error" in verdict ? { text: verdict.error, isError: true } : { text: verdict.label, isError: false };
    },
    savable: listWritableProxies,
  }, onChange);
}

export const RESOLVER_TEMPLATE_ERROR = "Not usable — paste an http(s) address that contains {doi}.";

/** The message to show beside a template field, or undefined while it is empty or valid. */
export function checkResolverTemplate(template: string): string | undefined {
  const text = template.trim();
  return text && !isCustomResolverTemplate(text) ? RESOLVER_TEMPLATE_ERROR : undefined;
}

/** The rows with a valid template, trimmed and in order; a blank name falls back to the template so every entry is nameable in logs. */
export function listWritableResolvers(rows: readonly CustomResolver[]): CustomResolver[] {
  return rows.flatMap((row) => {
    const template = row.template.trim();
    return isCustomResolverTemplate(template) ? [{ name: row.name.trim() || template, template, enabled: row.enabled }] : [];
  });
}

const RESOLVER_DESCRIPTION = [
  "Off until you add one. As a last resort for a paper no other source has, LabShelf opens each enabled address, top to bottom, ",
  "with ", renderInlineCode("{doi}"), " replaced by the paper's DOI, and attaches the PDF that page links to. Use an address you are allowed to use, such as ",
  renderInlineCode("https://host.example/find/{doi}"), ".",
];

export function createResolverSection(onChange: () => void): EditableListSection {
  return createEditableListSection({
    title: "Custom resolvers",
    description: RESOLVER_DESCRIPTION,
    idPrefix: "resolver",
    rowLabel: "Custom resolver",
    addLabel: "Add resolver",
    namePlaceholder: "Name",
    nameAriaLabel: "Resolver name",
    addressPlaceholder: "https://host.example/find/{doi}",
    addressAriaLabel: "Resolver address",
    judge(template) {
      const error = checkResolverTemplate(template);
      return error === undefined ? undefined : { text: error, isError: true };
    },
    savable: listWritableResolvers,
  }, onChange);
}
