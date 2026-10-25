// Builds a settings section holding an ordered list of rows, each with a name, an address, an enabled switch and a remove button.
import { renderActionButton, renderCheckboxField, renderElement, renderSettingsSection, renderTextField } from "@labshelf/core/dom";

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
