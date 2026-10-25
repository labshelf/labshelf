/** Builds one setting row: a label, a description and the control that edits it. */
import { renderElement } from "../dom.js";
import { renderContentNodes, type SettingsContent } from "./renderSettingsSection.js";

export interface SettingRowOptions {
  label?: string;
  /** Ties the label to a control by id; without it the label is plain text (e.g. for a group of buttons). */
  labelFor?: string;
  description?: SettingsContent;
}

function labelNode(options: SettingRowOptions): HTMLElement | null {
  if (options.label === undefined) { return null; }
  return options.labelFor
    ? renderElement("label", { class: "setting-label", for: options.labelFor, text: options.label })
    : renderElement("span", { class: "setting-label", text: options.label });
}

/** Labelled rows read label, description, control; a row without a label (a checkbox carries its own) reads control, description. */
export function renderSettingRow(options: SettingRowOptions, control: Node): HTMLElement {
  const label = labelNode(options);
  const description = options.description === undefined
    ? null
    : renderElement("div", { class: "setting-desc" }, ...renderContentNodes(options.description));
  return renderElement("div", { class: "setting" }, label, ...(label ? [description, control] : [control, description]));
}

/** Dims a setting that has no effect while another one is off. */
export function setRowDisabled(row: HTMLElement, disabled: boolean): void {
  row.classList.toggle("disabled", disabled);
}
