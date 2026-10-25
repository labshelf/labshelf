// Shows a strip of tabs where arrow keys, Home and End move the selection with a roving tabindex.
import { renderElement } from "../../../ui/dom/index.js";

/** One tab: its id, its visible label and the id of the panel it shows, when it has one. */
export interface TabSpec<T extends string> {
  id: T;
  label: string;
  controls?: string;
}

export interface TabListOptions<T extends string> {
  /** The accessible name of the strip. */
  label: string;
  onSelect: (id: T) => void;
  /** The tab selected at first; the first tab when absent. */
  selected?: T;
}

export class TabList<T extends string> {
  readonly el: HTMLElement;
  private readonly buttons: HTMLButtonElement[];
  private current: number;

  constructor(private readonly tabs: ReadonlyArray<TabSpec<T>>, private readonly options: TabListOptions<T>) {
    this.el = renderElement("div", { class: "rd-tabs", role: "tablist", "aria-label": options.label });
    this.buttons = tabs.map(({ id, label, controls }) => {
      const button = renderElement("button", { class: "rd-tab", type: "button", role: "tab", text: label });
      if (controls !== undefined) { button.setAttribute("aria-controls", controls); }
      button.addEventListener("click", () => this.select(id));
      return button;
    });
    this.current = Math.max(0, tabs.findIndex((t) => t.id === options.selected));
    this.el.append(...this.buttons);
    this.el.addEventListener("keydown", (e) => this.onKey(e));
    this.mark();
  }

  get selected(): T { return this.tabs[this.current]!.id; }

  /** @returns the button of the tab `id`, for callers that relabel or restyle it. */
  button(id: T): HTMLButtonElement { return this.buttons[this.indexOf(id)]!; }

  /** Selects the tab `id` and reports it; `focus` also moves keyboard focus onto it. */
  select(id: T, focus = false): void {
    this.current = this.indexOf(id);
    this.mark();
    if (focus) { this.buttons[this.current]!.focus(); }
    this.options.onSelect(id);
  }

  private indexOf(id: T): number { return this.tabs.findIndex((t) => t.id === id); }

  private mark(): void {
    this.buttons.forEach((button, i) => {
      button.setAttribute("aria-selected", String(i === this.current));
      button.tabIndex = i === this.current ? 0 : -1;
    });
  }

  private onKey(e: KeyboardEvent): void {
    const last = this.tabs.length - 1;
    const step: Record<string, number> = { ArrowRight: this.current + 1, ArrowLeft: this.current - 1, Home: 0, End: last };
    const target = step[e.key];
    if (target === undefined) { return; }
    e.preventDefault();
    const wrapped = target < 0 ? last : target > last ? 0 : target;
    this.select(this.tabs[wrapped]!.id, true);
  }
}
