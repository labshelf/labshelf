// Builds the project search controls: the search and replace fields, the option toggles and the scope switch.
import { el } from "../../../ui/dom/dom.js";
import { icon, type IconName } from "../../../ui/icons/index.js";
import type { SearchScopeMode } from "../protocol/index.js";
import type { SearchOptions } from "../searchPattern.js";

interface SearchFormState {
  query: string;
  replacement: string;
  options: SearchOptions;
  scope: SearchScopeMode;
}

export interface SearchForm {
  root: HTMLElement;
  query: HTMLInputElement;
  replacement: HTMLInputElement;
  replaceAll: HTMLButtonElement;
  state(): SearchFormState;
  replacing(): boolean;
}

function toggle(name: IconName, label: string, onChange: () => void): HTMLButtonElement {
  const button = el("button", { type: "button", class: "ls-icon-btn", title: label, "aria-label": label, "aria-pressed": "false", html: icon(name) });
  button.addEventListener("click", () => {
    button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
    onChange();
  });
  return button;
}

function scopeSwitch(onChange: () => void): { root: HTMLElement; value: () => SearchScopeMode } {
  const option = (label: string, checked: boolean): HTMLButtonElement =>
    el("button", { type: "button", class: "ls-psearch-scope-option", role: "radio", "aria-checked": String(checked), text: label });
  const file = option("This file", false);
  const project = option("Project", true);
  for (const [button, other] of [[file, project], [project, file]] as const) {
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-checked") === "true") { return; }
      button.setAttribute("aria-checked", "true");
      other.setAttribute("aria-checked", "false");
      onChange();
    });
  }
  const root = el("div", { class: "ls-psearch-scope", role: "radiogroup", "aria-label": "Search in" }, file, project);
  return { root, value: () => (file.getAttribute("aria-checked") === "true" ? "file" : "project") };
}

/** `onChange` fires on every edit of the query or an option; replace edits do not search again. */
export function createSearchForm(onChange: () => void): SearchForm {
  const query = el("input", { type: "text", class: "ls-psearch-input", placeholder: "Search", "aria-label": "Search", spellcheck: "false" });
  const replacement = el("input", { type: "text", class: "ls-psearch-input", placeholder: "Replace", "aria-label": "Replace", spellcheck: "false" });
  const matchCase = toggle("case-sensitive", "Match Case", onChange);
  const wholeWord = toggle("whole-word", "Match Whole Word", onChange);
  const regex = toggle("regex", "Use Regular Expression", onChange);
  const replaceAll = el("button", { type: "button", class: "ls-icon-btn", title: "Replace All", "aria-label": "Replace All", html: icon("replace-all") });
  const replaceRow = el("div", { class: "ls-search ls-psearch-field", hidden: true }, replacement, replaceAll);
  const expander = el("button", { type: "button", class: "ls-icon-btn ls-psearch-expander", title: "Toggle Replace", "aria-label": "Toggle Replace", "aria-expanded": "false", html: icon("chevron-right") });
  const scope = scopeSwitch(onChange);
  const root = el("div", { class: "ls-psearch-form" },
    expander,
    el("div", { class: "ls-psearch-fields" }, el("div", { class: "ls-search ls-psearch-field" }, query, matchCase, wholeWord, regex), replaceRow, scope.root));
  expander.addEventListener("click", () => {
    const open = replaceRow.hidden;
    replaceRow.hidden = !open;
    expander.setAttribute("aria-expanded", String(open));
    expander.innerHTML = icon(open ? "chevron-down" : "chevron-right");
    root.dispatchEvent(new Event("replace-toggle", { bubbles: true }));
  });
  query.addEventListener("input", onChange);
  const pressed = (button: HTMLButtonElement): boolean => button.getAttribute("aria-pressed") === "true";
  return {
    root, query, replacement, replaceAll,
    replacing: () => !replaceRow.hidden,
    state: () => ({
      query: query.value,
      replacement: replacement.value,
      options: { matchCase: pressed(matchCase), wholeWord: pressed(wholeWord), regex: pressed(regex) },
      scope: scope.value(),
    }),
  };
}
