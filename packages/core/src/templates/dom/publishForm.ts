// Renders the Publish form (name, category, license, description) and reads its values back as a draft.
import { renderElement } from "../../ui/dom/index.js";
import type { PublishDraft } from "../protocol/index.js";
import { CATEGORY_LABELS } from "../templateLabels.js";

export interface PublishForm {
  element: HTMLElement;
  /** The current values of the four controls. */
  read(): PublishDraft;
  /** Puts the draft's values back into the controls. */
  fill(draft: PublishDraft): void;
  /** Reports whether the required fields have a value. */
  isValid(): boolean;
}

const LICENSES = ["MIT", "MIT-0", "CC-BY-4.0", "LPPL-1.3c", "Apache-2.0"];
// "Other" is a catalog fallback, not something an author picks.
const CATEGORIES = Object.entries(CATEGORY_LABELS).filter(([id]) => id !== "other");

let nextFieldId = 0;

function labelled(label: string, control: HTMLElement): HTMLElement {
  control.id = `ls-tpl-publish-field-${nextFieldId++}`;
  return renderElement("div", { class: "ls-tpl-field" }, renderElement("label", { for: control.id, text: label }), control);
}

function select(options: ReadonlyArray<readonly [string, string]>): HTMLSelectElement {
  return renderElement("select", { class: "ls-input" }, ...options.map(([value, text]) => renderElement("option", { value, text })));
}

/** @param onEdit called after any control changed, so the caller can drop results that no longer match. */
export function createPublishForm(onEdit: () => void): PublishForm {
  const name = renderElement("input", { class: "ls-input", type: "text", required: true, "aria-required": "true" });
  const category = select(CATEGORIES);
  const license = select(LICENSES.map((id) => [id, id] as const));
  const description = renderElement("textarea", { class: "ls-input", rows: 4, required: true, "aria-required": "true" });
  const element = renderElement("div", { class: "ls-tpl-form" },
    labelled("Name", name), labelled("Category", category), labelled("License", license), labelled("Description", description));
  element.addEventListener("input", onEdit);

  return {
    element,
    read: () => ({ name: name.value, category: category.value, license: license.value, description: description.value }),
    fill(draft) {
      // A license the host prefilled that the list lacks stays selectable instead of silently turning into MIT.
      if (!LICENSES.includes(draft.license) && ![...license.options].some((o) => o.value === draft.license)) {
        license.append(renderElement("option", { value: draft.license, text: draft.license }));
      }
      name.value = draft.name;
      category.value = draft.category;
      license.value = draft.license;
      description.value = draft.description;
    },
    isValid: () => name.value.trim() !== "",
  };
}
