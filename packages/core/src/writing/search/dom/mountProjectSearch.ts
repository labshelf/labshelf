// Mounts the project search panel into a root element and connects its form and results to the host.
import { renderElement } from "../../../ui/dom/index.js";
import type { HostToSearch, SearchScopeLabel, SearchTransport, SearchScopeKind } from "../protocol/index.js";
import type { SearchResults } from "../searchResults.js";
import { createMatchList, type MatchList } from "./matchList.js";
import { renderIcon, type IconName } from "../../../ui/icons/index.js";
import type { SearchOptions } from "../searchPattern.js";
import { formatCount } from "../../../ui/index.js";

interface SearchFormState {
  query: string;
  replacement: string;
  options: SearchOptions;
  scope: SearchScopeKind;
}

interface SearchForm {
  root: HTMLElement;
  query: HTMLInputElement;
  replacement: HTMLInputElement;
  replaceAll: HTMLButtonElement;
  state(): SearchFormState;
  /** Shows or hides the choice to search one file; without it every search covers the project. */
  offerFileScope(offered: boolean): void;
  replacing(): boolean;
}

function toggle(name: IconName, label: string, onChange: () => void): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: "ls-icon-btn", title: label, "aria-label": label, "aria-pressed": "false", html: renderIcon(name) });
  button.addEventListener("click", () => {
    button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
    onChange();
  });
  return button;
}

function scopeSwitch(onChange: () => void): { root: HTMLElement; value: () => SearchScopeKind; offer(offered: boolean): void } {
  const option = (label: string, checked: boolean): HTMLButtonElement =>
    renderElement("button", { type: "button", class: "ls-psearch-scope-option", role: "radio", "aria-checked": String(checked), text: label });
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
  const root = renderElement("div", { class: "ls-psearch-scope", role: "radiogroup", "aria-label": "Search in" }, file, project);
  return {
    root,
    value: () => (!root.hidden && file.getAttribute("aria-checked") === "true" ? "file" : "project"),
    offer: (offered) => { root.hidden = !offered; },
  };
}

/** `onChange` fires on every edit of the query or an option; replace edits do not search again. */
function createSearchForm(onChange: () => void): SearchForm {
  const query = renderElement("input", { type: "text", class: "ls-psearch-input", placeholder: "Search", "aria-label": "Search", spellcheck: "false" });
  const replacement = renderElement("input", { type: "text", class: "ls-psearch-input", placeholder: "Replace", "aria-label": "Replace", spellcheck: "false" });
  const matchCase = toggle("case-sensitive", "Match Case", onChange);
  const wholeWord = toggle("whole-word", "Match Whole Word", onChange);
  const regex = toggle("regex", "Use Regular Expression", onChange);
  const replaceAll = renderElement("button", { type: "button", class: "ls-icon-btn", title: "Replace All", "aria-label": "Replace All", html: renderIcon("replace-all") });
  const replaceRow = renderElement("div", { class: "ls-search ls-psearch-field", hidden: true }, replacement, replaceAll);
  const expander = renderElement("button", { type: "button", class: "ls-icon-btn ls-psearch-expander", title: "Toggle Replace", "aria-label": "Toggle Replace", "aria-expanded": "false", html: renderIcon("chevron-right") });
  const scope = scopeSwitch(onChange);
  const root = renderElement("div", { class: "ls-psearch-form" },
    expander,
    renderElement("div", { class: "ls-psearch-fields" }, renderElement("div", { class: "ls-search ls-psearch-field" }, query, matchCase, wholeWord, regex), replaceRow, scope.root));
  expander.addEventListener("click", () => {
    const open = replaceRow.hidden;
    replaceRow.hidden = !open;
    expander.setAttribute("aria-expanded", String(open));
    expander.innerHTML = renderIcon(open ? "chevron-down" : "chevron-right");
    root.dispatchEvent(new Event("replace-toggle", { bubbles: true }));
  });
  query.addEventListener("input", onChange);
  const pressed = (button: HTMLButtonElement): boolean => button.getAttribute("aria-pressed") === "true";
  return {
    root, query, replacement, replaceAll,
    replacing: () => !replaceRow.hidden,
    offerFileScope: scope.offer,
    state: () => ({
      query: query.value,
      replacement: replacement.value,
      options: { matchCase: pressed(matchCase), wholeWord: pressed(wholeWord), regex: pressed(regex) },
      scope: scope.value(),
    }),
  };
}

/** `current` is -1 when no result is open; returns -1 when `count` is 0. */
export function deriveSteppedMatch(current: number, count: number, step: 1 | -1): number {
  if (count === 0) { return -1; }
  if (current < 0 || current >= count) { return step === 1 ? 0 : count - 1; }
  return (current + step + count) % count;
}

function summaryText(results: SearchResults): string {
  if (results.total === 0) { return "No results"; }
  const found = `${formatCount(results.total, "result")} in ${formatCount(results.files.length, "file")}`;
  return results.truncated ? `${found}. Only the first ${results.total} are shown; narrow the search to see the rest.` : found;
}

interface SearchPanel {
  form: SearchForm;
  list: MatchList;
  scopeLine: HTMLElement;
  summary: HTMLElement;
  /** Shows the form and results, or the notice for a file outside every writing project. */
  showScope(inProject: boolean): void;
}

function buildPanel(root: HTMLElement, transport: SearchTransport, search: () => void): SearchPanel {
  const form = createSearchForm(search);
  const replacement = (): string => form.state().replacement;
  const list = createMatchList({
    open: (at) => transport.post({ type: "open", ...at }),
    replace: (at) => transport.post({ type: "replace", ...at, replacement: replacement() }),
    replaceFile: (path) => transport.post({ type: "replaceFile", path, replacement: replacement() }),
  });
  const scopeLine = renderElement("div", { class: "ls-psearch-scope-line" });
  const summary = renderElement("div", { class: "ls-psearch-summary", role: "status" });
  const outside = renderElement("p", { class: "ls-psearch-outside", text: "This file is not in a writing project.", hidden: true });
  const panel = renderElement("div", { class: "ls-psearch-panel" }, form.root, scopeLine, summary, list.root);
  root.replaceChildren(renderElement("div", { class: "ls-psearch" }, panel, outside));
  form.root.addEventListener("replace-toggle", () => list.setReplacing(form.replacing()));
  form.replaceAll.addEventListener("click", () => transport.post({ type: "replaceAll", replacement: replacement() }));
  form.replaceAll.disabled = true;
  return {
    form, list, scopeLine, summary,
    showScope(inProject) { outside.hidden = inProject; panel.hidden = !inProject; },
  };
}

export function mountProjectSearch(root: HTMLElement, transport: SearchTransport): void {
  let scope: SearchScopeLabel | null = null;
  const search = (): void => {
    renderScope();
    if (!scope) { return; }
    const { query, options, scope: mode } = form.state();
    transport.post({ type: "search", query, options, scope: mode });
  };
  const { form, list, scopeLine, summary, showScope } = buildPanel(root, transport, search);

  function renderScope(): void {
    showScope(scope !== null);
    if (!scope) { return; }
    form.offerFileScope(scope.file !== null);
    scopeLine.textContent = form.state().scope === "file" && scope.file !== null ? scope.file : `${scope.project} · ${scope.folder}`;
    scopeLine.title = scopeLine.textContent;
  }

  function showResults(results: SearchResults, message?: string): void {
    list.render(results);
    summary.textContent = message ?? (form.state().query === "" ? "" : summaryText(results));
    form.replaceAll.disabled = results.total === 0;
  }

  form.query.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") { return; }
    event.preventDefault();
    const at = list.select(deriveSteppedMatch(list.selected(), list.count(), event.shiftKey ? -1 : 1));
    if (at) { transport.post({ type: "open", ...at }); }
  });
  transport.subscribe((message: HostToSearch) => {
    if (message.type === "seed") {
      form.query.value = message.query;
      form.query.focus();
      form.query.select();
    }
    if (message.type === "scope") { scope = message.scope; }
    if (message.type === "seed" || message.type === "scope") { search(); }
    if (message.type === "results") { showResults(message.results); }
    if (message.type === "invalid") { showResults({ files: [], total: 0, truncated: false }, message.message); }
  });
  renderScope();
  transport.post({ type: "ready" });
}
