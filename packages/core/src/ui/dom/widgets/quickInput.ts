// Shows a filterable quick pick and a validated input box; both resolve to `undefined` when dismissed.
import { renderIcon, type IconName } from "../../icons/index.js";
import { renderElement, renderHighlightedHtml } from "../dom.js";
import { mountOverlay } from "./overlay.js";

export interface QuickPickItem<T> {
  label: string;
  description?: string;
  icon?: IconName;
  value: T;
}

/** A non-selectable category heading; it shows only while an item follows it in the filtered list. */
export interface QuickInputSeparator {
  kind: "separator";
  label: string;
}

export type QuickPickEntry<T> = QuickPickItem<T> | QuickInputSeparator;

export interface QuickPickOptions {
  title?: string;
  placeholder?: string;
  signal?: AbortSignal;
}

export interface InputBoxOptions {
  signal?: AbortSignal;
  title?: string;
  prompt?: string;
  value?: string;
  placeholder?: string;
  /** Returns an error message to block submission, or null/undefined to accept. */
  validate?: (value: string) => string | null | undefined;
}

let quickCount = 0;

/** Builds the dialog box, named by its title or, untitled, by the input's placeholder. */
function quickBox(title: string | undefined, input: HTMLInputElement, below: HTMLElement): HTMLDivElement {
  const id = `ls-quick-${++quickCount}`;
  const box = renderElement("div", { class: "ls-quick", role: "dialog", "aria-modal": "true" },
    title ? renderElement("div", { class: "ls-quick-title", id: `${id}-title`, text: title }) : null, input, below);
  if (title) box.setAttribute("aria-labelledby", `${id}-title`);
  else if (input.placeholder) box.setAttribute("aria-label", input.placeholder);
  return box;
}

/** The entries that match every token, each separator kept only when a matching item follows it. */
function filterEntries<T>(entries: QuickPickEntry<T>[], toks: string[]): QuickPickEntry<T>[] {
  const matches = (it: QuickPickItem<T>): boolean => toks.every((t) => `${it.label} ${it.description ?? ""}`.toLowerCase().includes(t));
  const kept: QuickPickEntry<T>[] = [];
  let heading: QuickInputSeparator | undefined;
  for (const entry of entries) {
    if ("kind" in entry) { heading = entry; continue; }
    if (!matches(entry)) continue;
    if (heading) { kept.push(heading); heading = undefined; }
    kept.push(entry);
  }
  return kept;
}

function renderPickRows<T>(list: HTMLElement, rows: QuickPickEntry<T>[], active: number, tokens: string[], hover: (i: number) => void, pick: (i: number) => void): void {
  list.replaceChildren();
  let index = 0;
  for (const entry of rows) {
    if ("kind" in entry) { list.append(renderElement("div", { class: "ls-quick-sep", role: "presentation", text: entry.label })); continue; }
    const i = index++;
    const row = renderElement("div", {
      class: `ls-quick-item${i === active ? " active" : ""}`, role: "option",
      html: `${entry.icon ? renderIcon(entry.icon) : ""}<span class="label">${renderHighlightedHtml(entry.label, tokens)}</span>${entry.description ? `<span class="desc">${renderHighlightedHtml(entry.description, tokens)}</span>` : ""}`,
    });
    row.addEventListener("mousemove", () => hover(i));
    row.addEventListener("click", () => pick(i));
    list.append(row);
  }
  if (!index) list.append(renderElement("div", { class: "ls-quick-empty", text: "No matching results" }));
}

/** Shows a filterable list; resolves with the chosen item's value. */
export function pickQuickEntry<T>(entries: QuickPickEntry<T>[], opts: QuickPickOptions = {}): Promise<T | undefined> {
  if (opts.signal?.aborted) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const input = renderElement("input", { class: "ls-input", type: "text", placeholder: opts.placeholder ?? "", spellcheck: "false", autocomplete: "off" });
    const list = renderElement("div", { class: "ls-quick-list", role: "listbox" });
    const box = quickBox(opts.title, input, list);
    const { close } = mountOverlay(box, () => resolve(undefined), opts.signal ? { signal: opts.signal } : {});
    let visible: QuickPickItem<T>[] = [];
    let active = 0;
    const hover = (i: number): void => {
      if (active === i) return;
      active = i;
      list.querySelectorAll(".ls-quick-item").forEach((r, n) => r.classList.toggle("active", n === active));
      list.querySelector(".ls-quick-item.active")?.scrollIntoView({ block: "nearest" });
    };
    const pick = (i: number): void => {
      if (opts.signal?.aborted) return;
      const it = visible[i];
      if (it) { close(); resolve(it.value); }
    };
    const render = (): void => {
      const rows = filterEntries(entries, input.value.toLowerCase().split(" ").filter(Boolean));
      visible = rows.filter((entry): entry is QuickPickItem<T> => !("kind" in entry));
      active = Math.min(active, Math.max(0, visible.length - 1));
      renderPickRows(list, rows, active, input.value.toLowerCase().split(" ").filter(Boolean), hover, pick);
    };
    input.addEventListener("input", render);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); hover(Math.min(visible.length - 1, active + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); hover(Math.max(0, active - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); pick(active); }
    });
    render(); input.focus();
  });
}

/** Shows a single-line input; resolves with the trimmed value or undefined when cancelled. */
export function askInputBox(opts: InputBoxOptions = {}): Promise<string | undefined> {
  if (opts.signal?.aborted) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const input = renderElement("input", { class: "ls-input", type: "text", value: opts.value ?? "", placeholder: opts.placeholder ?? "", spellcheck: "false", autocomplete: "off" });
    const msg = renderElement("div", { class: "ls-quick-msg", id: `ls-quick-msg-${++quickCount}`, text: opts.prompt ?? "" });
    const box = quickBox(opts.title, input, msg);
    box.setAttribute("aria-describedby", msg.id);
    const { close } = mountOverlay(box, () => resolve(undefined), opts.signal ? { signal: opts.signal } : {});

    const validate = (): string | null => {
      const error = opts.validate?.(input.value) ?? null;
      input.setAttribute("aria-invalid", error ? "true" : "false");
      msg.classList.toggle("error", !!error);
      msg.textContent = error ?? opts.prompt ?? "";
      return error;
    };
    input.addEventListener("input", validate);
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || opts.signal?.aborted) return;
      e.preventDefault();
      if (validate()) return;
      close();
      resolve(input.value.trim());
    });
    input.focus();
    input.select();
  });
}
