// Builds the Custom resolvers section: an ordered list of address templates, each with a name, an enabled switch and a remove button.
import type { CustomResolver } from "@labshelf/core";
import { actionButton, checkboxField, el, inlineCode, settingsSection, textField } from "@labshelf/core/dom";
import { judgeResolverTemplate, savableResolvers } from "./resolverRows";

export interface ResolverSection {
  element: HTMLElement;
  /** The rows that can be saved, in list order. */
  read(): CustomResolver[];
  fill(resolvers: readonly CustomResolver[]): void;
}

const DESCRIPTION = [
  "Off until you add one. As a last resort for a paper no other source has, LabShelf opens each enabled address, top to bottom, ",
  "with ", inlineCode("{doi}"), " replaced by the paper's DOI, and attaches the PDF that page links to. Use an address you are allowed to use, such as ",
  inlineCode("https://host.example/find/{doi}"), ".",
];

let rowSeq = 0;

function createRow(resolver: CustomResolver, onRemove: (row: HTMLElement) => void): HTMLElement {
  const id = `resolver-${++rowSeq}`;
  const name = textField({ id: `${id}-name`, type: "text", placeholder: "Name" });
  const template = textField({ id: `${id}-template`, type: "text", placeholder: "https://host.example/find/{doi}" });
  const enabled = checkboxField({ id: `${id}-enabled`, label: "Enabled", checked: resolver.enabled });
  const status = el("span", { id: `${id}-status`, class: "editable-status", "aria-live": "polite" });
  const remove = actionButton({ label: "Remove", icon: "trash", onClick: () => onRemove(row) });
  name.control.setAttribute("aria-label", "Resolver name");
  template.control.setAttribute("aria-label", "Resolver address");
  name.control.value = resolver.name;
  template.control.value = resolver.template;
  template.control.setAttribute("aria-describedby", status.id);
  const row = el("div", { class: "editable-row", role: "group" }, name.element, template.element, enabled.element, remove, status);
  row.addEventListener("input", () => showVerdict(template.control, status));
  showVerdict(template.control, status);
  return row;
}

function showVerdict(template: HTMLInputElement, status: HTMLElement): void {
  const error = judgeResolverTemplate(template.value);
  status.textContent = error ?? "";
  status.classList.toggle("editable-status-error", error !== undefined);
  template.setAttribute("aria-invalid", String(error !== undefined));
}

export function createResolverSection(onChange: () => void): ResolverSection {
  const list = el("div", { class: "editable-list" });
  const labelRows = (): void => {
    [...list.children].forEach((row, i) => row.setAttribute("aria-label", `Custom resolver ${i + 1}`));
  };
  const add = (resolver: CustomResolver): void => { list.append(createRow(resolver, remove)); labelRows(); };
  const remove = (row: HTMLElement): void => { row.remove(); labelRows(); onChange(); };
  list.addEventListener("input", onChange);
  list.addEventListener("change", onChange);

  const addButton = actionButton({ label: "Add resolver", icon: "plus", onClick: () => add({ name: "", template: "", enabled: true }) });
  const element = settingsSection({ title: "Custom resolvers", description: DESCRIPTION }, list, el("div", { class: "settings-actions" }, addButton));
  return {
    element,
    read: () => savableResolvers([...list.children].map((row) => ({
      name: row.querySelector<HTMLInputElement>("input[id$='-name']")!.value,
      template: row.querySelector<HTMLInputElement>("input[id$='-template']")!.value,
      enabled: row.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked,
    }))),
    fill(resolvers) {
      list.replaceChildren();
      resolvers.forEach(add);
    },
  };
}
