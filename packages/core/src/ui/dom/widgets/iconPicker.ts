// Asks for one icon of the Tabler library: a modal with a search box, category chips, a grid of icons and a Default option.
import { TABLER_CATEGORIES, renderTablerIcon, searchTablerIcons, type TablerCategory } from "../../icons/index.js";
import { renderElement } from "../dom.js";
import { mountOverlay } from "./dialog.js";

export interface IconPickerOptions {
  title: string;
  /** The icon in use, marked pressed in the grid. */
  current?: string | undefined;
  /** Label of the option that clears the icon. */
  defaultLabel?: string;
}

/** Icons per grid row; the arrow keys move by it, and the CSS lays the grid out with it. */
const COLUMNS = 8;

/** Resolves with the picked icon name, null for the Default option, or undefined when the user cancels. */
export function askIconPicker(opts: IconPickerOptions): Promise<string | null | undefined> {
  return new Promise((resolve) => {
    let category: TablerCategory | undefined;
    const search = renderElement("input", { class: "ls-input ls-icon-picker-search", type: "search", placeholder: "Search icons", "aria-label": "Search icons" }) as HTMLInputElement;
    const chips = renderElement("div", { class: "ls-icon-picker-chips", role: "group", "aria-label": "Category" });
    const grid = renderElement("div", { class: "ls-icon-picker-grid", role: "group", "aria-label": "Icons", style: `--columns:${COLUMNS}` });
    const empty = renderElement("div", { class: "ls-icon-picker-empty", text: "No icons match." });
    const reset = renderElement("button", { class: "ls-btn", type: "button", "data-icon-default": "", text: opts.defaultLabel ?? "Default" });
    const cancel = renderElement("button", { class: "ls-btn", type: "button", "data-icon-cancel": "", text: "Cancel" });
    const box = renderElement("div", { class: "ls-dialog ls-icon-picker", role: "dialog", "aria-modal": "true", "aria-label": opts.title },
      renderElement("div", { class: "ls-dialog-title", text: opts.title }),
      search, chips, grid, empty,
      renderElement("div", { class: "ls-dialog-actions" }, reset, cancel),
    );
    const { close } = mountOverlay(box, () => resolve(undefined));
    const finish = (value: string | null | undefined): void => { close(); resolve(value); };

    const chipButtons = [undefined, ...TABLER_CATEGORIES].map((c) => {
      const chip = renderElement("button", { class: "ls-icon-picker-chip", type: "button", "data-category": c ?? "", text: c ?? "All" });
      chip.addEventListener("click", () => { category = c; draw(); });
      return chip;
    });
    chips.append(...chipButtons);

    const icons = (): HTMLButtonElement[] => [...grid.querySelectorAll<HTMLButtonElement>("[data-icon]")];
    function draw(): void {
      for (const chip of chipButtons) chip.setAttribute("aria-pressed", String((chip.dataset["category"] || undefined) === category));
      const found = searchTablerIcons(search.value, category);
      grid.replaceChildren(...found.map((icon) => {
        const button = renderElement("button", {
          class: "ls-icon-picker-icon", type: "button", "data-icon": icon.name, title: icon.label, "aria-label": icon.label,
          "aria-pressed": String(icon.name === opts.current), html: renderTablerIcon(icon.name) ?? "",
        });
        button.addEventListener("click", () => finish(icon.name));
        return button;
      }));
      empty.hidden = found.length > 0;
    }

    search.addEventListener("input", draw);
    search.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown") return;
      e.preventDefault();
      icons()[0]?.focus();
    });
    grid.addEventListener("keydown", (e) => {
      const all = icons();
      const at = all.indexOf(e.target as HTMLButtonElement);
      if (at < 0) return;
      const next = { ArrowRight: at + 1, ArrowLeft: at - 1, ArrowDown: at + COLUMNS, ArrowUp: at - COLUMNS, Home: 0, End: all.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      if (next < 0) search.focus();
      else all[Math.min(next, all.length - 1)]?.focus();
    });
    reset.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(undefined));
    draw();
    search.focus();
  });
}
