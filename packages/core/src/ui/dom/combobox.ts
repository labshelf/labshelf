// Draws a free-text input with a suggestion listbox under it (ARIA combobox): typing filters, arrows move the active option, Enter picks it, Escape closes.
import { renderElement } from "./dom.js";

export interface ComboboxSuggestion {
  label: string;
  /** A second line of text, such as an email under a name; it is searched too. */
  detail?: string;
  /** What the input holds once the suggestion is picked. */
  value: string;
}

export interface ComboboxOptions {
  /** The input's accessible name. */
  label: string;
  suggestions: readonly ComboboxSuggestion[];
  value?: string;
  placeholder?: string;
  /** The input's type, such as "email". */
  type?: string;
  name?: string;
  /** Lists every suggestion when the input gets focus or is emptied, as a picker does; by default the list opens only once something is typed. */
  listAll?: boolean;
  /** Called after the input has been set to the picked suggestion's value. */
  onPick?: (suggestion: ComboboxSuggestion) => void;
}

export interface Combobox {
  root: HTMLElement;
  input: HTMLInputElement;
  /** Replaces the suggestions and refreshes the open list. */
  setSuggestions(suggestions: readonly ComboboxSuggestion[]): void;
  dispose(): void;
}

/** What the handlers of one mounted combobox share. */
interface ComboboxState {
  id: string;
  input: HTMLInputElement;
  list: HTMLElement;
  suggestions: readonly ComboboxSuggestion[];
  visible: ComboboxSuggestion[];
  open: boolean;
  active: number;
  picking: boolean;
  onPick: ((suggestion: ComboboxSuggestion) => void) | undefined;
}

let comboboxCount = 0;

function matchSuggestions(suggestions: readonly ComboboxSuggestion[], query: string): ComboboxSuggestion[] {
  const tokens = query.toLowerCase().split(" ").filter(Boolean);
  return suggestions.filter((s) => tokens.every((t) => `${s.label} ${s.detail ?? ""} ${s.value}`.toLowerCase().includes(t)));
}

/** Brings the list's visibility, the ARIA state and the active row in line with the state. */
function syncList(st: ComboboxState): void {
  const { input, list } = st;
  const shown = st.open && st.visible.length > 0;
  list.hidden = !shown;
  input.setAttribute("aria-expanded", String(shown));
  const row = shown && st.active >= 0 ? list.children[st.active] : undefined;
  if (row) input.setAttribute("aria-activedescendant", row.id);
  else input.removeAttribute("aria-activedescendant");
  list.querySelectorAll(".ls-combobox-option").forEach((r, n) => {
    r.classList.toggle("active", n === st.active);
    r.setAttribute("aria-selected", String(n === st.active));
  });
  row?.scrollIntoView({ block: "nearest" });
}

function closeList(st: ComboboxState): void {
  st.open = false;
  st.active = -1;
  syncList(st);
}

function pickSuggestion(st: ComboboxState, i: number): void {
  const s = st.visible[i];
  if (!s) return;
  st.input.value = s.value;
  closeList(st);
  // Lets form listeners see the new value without reopening the list.
  st.picking = true;
  try { st.input.dispatchEvent(new Event("input", { bubbles: true })); } finally { st.picking = false; }
  st.onPick?.(s);
}

function renderOption(st: ComboboxState, s: ComboboxSuggestion, i: number): HTMLElement {
  const row = renderElement("div", { class: "ls-combobox-option", id: `${st.id}-option-${i}`, role: "option", "aria-selected": "false" },
    renderElement("span", { class: "label", text: s.label }));
  if (s.detail) row.append(renderElement("span", { class: "desc", text: s.detail }));
  row.addEventListener("mousemove", () => { if (st.active !== i) { st.active = i; syncList(st); } });
  row.addEventListener("click", () => pickSuggestion(st, i));
  return row;
}

function renderList(st: ComboboxState): void {
  st.visible = matchSuggestions(st.suggestions, st.input.value);
  st.active = Math.min(st.active, st.visible.length - 1);
  st.list.replaceChildren();
  st.visible.forEach((s, i) => st.list.append(renderOption(st, s, i)));
  syncList(st);
}

function handleKeydown(st: ComboboxState, e: KeyboardEvent): void {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!st.open) { st.open = true; st.active = -1; renderList(st); }
    if (st.visible.length === 0) return;
    st.active = e.key === "ArrowDown" ? Math.min(st.visible.length - 1, st.active + 1) : Math.max(0, st.active - 1);
    syncList(st);
  } else if (e.key === "Enter") {
    if (!st.open || st.active < 0 || !st.visible[st.active]) return;
    // Picking is the whole action: neither the form nor an outer Enter handler (a dialog's submit) sees it.
    e.preventDefault();
    e.stopPropagation();
    pickSuggestion(st, st.active);
  } else if (e.key === "Escape" && st.open && st.visible.length > 0) {
    e.preventDefault();
    e.stopPropagation();
    closeList(st);
  }
}

function renderInput(opts: ComboboxOptions, id: string): HTMLInputElement {
  const input = renderElement("input", {
    class: "ls-input", type: opts.type ?? "text", value: opts.value ?? "", placeholder: opts.placeholder ?? "",
    spellcheck: "false", autocomplete: "off", role: "combobox", "aria-label": opts.label,
    "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": `${id}-list`,
  });
  if (opts.name) input.name = opts.name;
  return input;
}

/** Mounts a combobox; append `root` where it belongs (a form field, for one). The typed text stays valid when nothing matches. */
export function mountCombobox(opts: ComboboxOptions): Combobox {
  const id = `ls-combobox-${++comboboxCount}`;
  const input = renderInput(opts, id);
  const list = renderElement("div", { class: "ls-combobox-list", id: `${id}-list`, role: "listbox", "aria-label": opts.label });
  list.hidden = true;
  const root = renderElement("div", { class: "ls-combobox" }, input, list);
  const st: ComboboxState = { id, input, list, suggestions: opts.suggestions, visible: [], open: false, active: -1, picking: false, onPick: opts.onPick };

  const onInput = (): void => {
    if (st.picking) return;
    st.open = opts.listAll === true || input.value.trim().length > 0;
    st.active = -1;
    renderList(st);
  };
  // A picker lists every suggestion on focus, whatever the input holds.
  const onFocus = (): void => {
    st.open = true;
    st.active = -1;
    st.visible = [...st.suggestions];
    st.list.replaceChildren(...st.visible.map((s, i) => renderOption(st, s, i)));
    syncList(st);
  };
  const onKeydown = (e: KeyboardEvent): void => handleKeydown(st, e);
  const onBlur = (): void => closeList(st);
  // Keeps the input focused while the pointer is on the list.
  const onListMousedown = (e: Event): void => e.preventDefault();

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeydown);
  input.addEventListener("blur", onBlur);
  if (opts.listAll) input.addEventListener("focus", onFocus);
  list.addEventListener("mousedown", onListMousedown);

  return {
    root, input,
    setSuggestions(next) { st.suggestions = next; if (st.open) renderList(st); },
    dispose() {
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeydown);
      input.removeEventListener("blur", onBlur);
      input.removeEventListener("focus", onFocus);
      list.removeEventListener("mousedown", onListMousedown);
      root.remove();
    },
  };
}
