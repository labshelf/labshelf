// Shows a filterable quick pick and a validated input box; both resolve to `undefined` when dismissed.
import { icon, type IconName } from "../../icons/index.js";
import { el, highlight } from "../dom.js";
import { mountOverlay } from "./overlay.js";

export interface QuickPickItem<T> {
  label: string;
  description?: string;
  icon?: IconName;
  value: T;
}

/** A non-selectable category heading; it shows only while an item follows it in the filtered list. */
export interface QuickPickSeparator {
  kind: "separator";
  label: string;
}

export type QuickPickEntry<T> = QuickPickItem<T> | QuickPickSeparator;

export interface QuickPickOptions {
  title?: string;
  placeholder?: string;
}

export interface InputBoxOptions {
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
  const box = el("div", { class: "ls-quick", role: "dialog", "aria-modal": "true" },
    title ? el("div", { class: "ls-quick-title", id: `${id}-title`, text: title }) : null, input, below);
  if (title) box.setAttribute("aria-labelledby", `${id}-title`);
  else if (input.placeholder) box.setAttribute("aria-label", input.placeholder);
  return box;
}

/** The entries that match every token, each separator kept only when a matching item follows it. */
function filterEntries<T>(entries: QuickPickEntry<T>[], toks: string[]): QuickPickEntry<T>[] {
  const matches = (it: QuickPickItem<T>): boolean => toks.every((t) => `${it.label} ${it.description ?? ""}`.toLowerCase().includes(t));
  const kept: QuickPickEntry<T>[] = [];
  let heading: QuickPickSeparator | undefined;
  for (const entry of entries) {
    if ("kind" in entry) { heading = entry; continue; }
    if (!matches(entry)) continue;
    if (heading) { kept.push(heading); heading = undefined; }
    kept.push(entry);
  }
  return kept;
}

/** Shows a filterable list; resolves with the chosen item's value. */
export function quickPick<T>(entries: QuickPickEntry<T>[], opts: QuickPickOptions = {}): Promise<T | undefined> {
  return new Promise((resolve) => {
    const input = el("input", { class: "ls-input", type: "text", placeholder: opts.placeholder ?? "", spellcheck: "false", autocomplete: "off" });
    const list = el("div", { class: "ls-quick-list", role: "listbox" });
    const box = quickBox(opts.title, input, list);
    const { close } = mountOverlay(box, () => resolve(undefined));

    let visible: QuickPickItem<T>[] = [];
    let active = 0;

    const render = (): void => {
      const toks = input.value.toLowerCase().split(" ").filter(Boolean);
      const rows = filterEntries(entries, toks);
      visible = rows.filter((entry): entry is QuickPickItem<T> => !("kind" in entry));
      active = Math.min(active, Math.max(0, visible.length - 1));
      list.innerHTML = visible.length === 0 ? `<div class="ls-quick-empty">No matching results</div>` : "";
      let index = 0;
      for (const entry of rows) {
        if ("kind" in entry) { list.append(el("div", { class: "ls-quick-sep", role: "presentation", text: entry.label })); continue; }
        const i = index++;
        const row = el("div", {
          class: `ls-quick-item${i === active ? " active" : ""}`,
          role: "option",
          html: `${entry.icon ? icon(entry.icon) : ""}<span class="label">${highlight(entry.label, toks)}</span>${entry.description ? `<span class="desc">${highlight(entry.description, toks)}</span>` : ""}`,
        });
        row.addEventListener("mousemove", () => { if (active !== i) { active = i; paintActive(); } });
        row.addEventListener("click", () => pick(i));
        list.append(row);
      }
    };
    const paintActive = (): void => {
      list.querySelectorAll(".ls-quick-item").forEach((r, i) => r.classList.toggle("active", i === active));
      list.querySelector(".ls-quick-item.active")?.scrollIntoView({ block: "nearest" });
    };
    const pick = (i: number): void => {
      const it = visible[i];
      if (!it) return;
      close();
      resolve(it.value);
    };

    input.addEventListener("input", render);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(visible.length - 1, active + 1); paintActive(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); paintActive(); }
      else if (e.key === "Enter") { e.preventDefault(); pick(active); }
    });
    render();
    input.focus();
  });
}

/** Shows a single-line input; resolves with the trimmed value or undefined when cancelled. */
export function inputBox(opts: InputBoxOptions = {}): Promise<string | undefined> {
  return new Promise((resolve) => {
    const input = el("input", { class: "ls-input", type: "text", value: opts.value ?? "", placeholder: opts.placeholder ?? "", spellcheck: "false", autocomplete: "off" });
    const msg = el("div", { class: "ls-quick-msg", id: `ls-quick-msg-${++quickCount}`, text: opts.prompt ?? "" });
    const box = quickBox(opts.title, input, msg);
    box.setAttribute("aria-describedby", msg.id);
    const { close } = mountOverlay(box, () => resolve(undefined));

    const validate = (): string | null => {
      const error = opts.validate?.(input.value) ?? null;
      input.setAttribute("aria-invalid", error ? "true" : "false");
      msg.classList.toggle("error", !!error);
      msg.textContent = error ?? opts.prompt ?? "";
      return error;
    };
    input.addEventListener("input", validate);
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (validate()) return;
      close();
      resolve(input.value.trim());
    });
    input.focus();
    input.select();
  });
}
