// Mounts the project search panel into a root element and connects its form and results to the host.
import { el } from "../../../ui/dom/dom.js";
import type { HostToSearch, SearchScopeLabel, SearchTransport } from "../protocol/index.js";
import type { SearchResults } from "../searchResults.js";
import { createResultsList, type ResultsList } from "./matchList.js";
import { createSearchForm, type SearchForm } from "./searchForm.js";
import { stepResult } from "./stepResult.js";

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

function summaryText(results: SearchResults): string {
  if (results.total === 0) { return "No results"; }
  const found = `${plural(results.total, "result")} in ${plural(results.files.length, "file")}`;
  return results.truncated ? `${found}. Only the first ${results.total} are shown; narrow the search to see the rest.` : found;
}

interface SearchPanel {
  form: SearchForm;
  list: ResultsList;
  scopeLine: HTMLElement;
  summary: HTMLElement;
  /** Shows the form and results, or the notice for a file outside every writing project. */
  showScope(inProject: boolean): void;
}

function buildPanel(root: HTMLElement, transport: SearchTransport, search: () => void): SearchPanel {
  const form = createSearchForm(search);
  const replacement = (): string => form.state().replacement;
  const list = createResultsList({
    open: (at) => transport.post({ type: "open", ...at }),
    replace: (at) => transport.post({ type: "replace", ...at, replacement: replacement() }),
    replaceFile: (path) => transport.post({ type: "replaceFile", path, replacement: replacement() }),
  });
  const scopeLine = el("div", { class: "ls-psearch-scope-line" });
  const summary = el("div", { class: "ls-psearch-summary", role: "status" });
  const outside = el("p", { class: "ls-psearch-outside", text: "This file is not in a writing project.", hidden: true });
  const panel = el("div", { class: "ls-psearch-panel" }, form.root, scopeLine, summary, list.root);
  root.replaceChildren(el("div", { class: "ls-psearch" }, panel, outside));
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
    const at = list.select(stepResult(list.selected(), list.count(), event.shiftKey ? -1 : 1));
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
