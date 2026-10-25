// Builds a group of toggle buttons where exactly one option is pressed and a click reports its id.
import { renderElement } from "../../dom.js";

export interface SegmentedOption {
  id: string;
  label: string;
  count?: number;
}

export interface SegmentedFilterOptions {
  label: string;
  options: readonly SegmentedOption[];
  selected: string;
  onSelect(id: string): void;
}

export function renderSegmentedFilter(opts: SegmentedFilterOptions): HTMLElement {
  const group = renderElement("div", { class: "ls-segmented", role: "group", "aria-label": opts.label });
  const buttons = opts.options.map((o) => {
    const b = renderElement("button", { class: "ls-segmented-option", type: "button" }, o.label,
      o.count === undefined ? null : renderElement("span", { class: "ls-segmented-count", text: String(o.count) }));
    b.addEventListener("click", () => {
      mark(o.id);
      opts.onSelect(o.id);
    });
    return b;
  });
  const mark = (id: string): void => {
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(opts.options[i]!.id === id)));
  };
  mark(opts.selected);
  group.append(...buttons);
  return group;
}
