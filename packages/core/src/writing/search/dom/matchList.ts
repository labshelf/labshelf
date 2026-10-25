// Renders project search results as collapsible per-file lists of highlighted matches with their replace actions.
import { renderElement } from "../../../ui/dom/dom.js";
import { renderIcon } from "../../../ui/icons/index.js";
import type { MatchLocation } from "../protocol/index.js";
import type { FileResults, SearchResults } from "../searchResults.js";

export interface ResultsActions {
  open(at: MatchLocation): void;
  replace(at: MatchLocation): void;
  replaceFile(path: string): void;
}

export interface ResultsList {
  root: HTMLElement;
  render(results: SearchResults): void;
  /** Shows the per-match and per-file replace buttons only while the replace field is open. */
  setReplacing(on: boolean): void;
  count(): number;
  /** The index of the current match, or -1 when none is. */
  selected(): number;
  /** Marks the match at `index` as current, scrolls to it and returns where it is. */
  select(index: number): MatchLocation | undefined;
}

const ROW = ".ls-psearch-row";

function actionButton(label: string, name: "replace" | "replace-all", onClick: () => void): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: "ls-icon-btn ls-psearch-action", title: label, "aria-label": label, html: renderIcon(name) });
  button.addEventListener("click", (event) => { event.stopPropagation(); onClick(); });
  return button;
}

function activateOnEnter(row: HTMLElement, activate: () => void): void {
  row.addEventListener("click", activate);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target === row) { event.preventDefault(); activate(); }
  });
}

/** Moves focus to the previous or next visible row; collapsed files hide their matches from the walk. */
function moveFocus(root: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") { return; }
  const rows = [...root.querySelectorAll<HTMLElement>(ROW)].filter((row) => !row.closest("[hidden]"));
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const next = rows[at + (event.key === "ArrowDown" ? 1 : -1)];
  if (!next) { return; }
  event.preventDefault();
  next.focus();
}

/** The file row: it collapses and expands `matches` and carries the file's Replace All button. */
function fileHeader(file: FileResults, matches: HTMLElement, replaceFile: () => void): HTMLElement {
  const twistie = renderElement("span", { class: "ls-psearch-twistie", html: renderIcon("chevron-down") });
  const header = renderElement("div", { class: "ls-psearch-row ls-psearch-file", tabindex: "-1", "aria-expanded": "true", title: file.path },
    twistie,
    renderElement("span", { class: "ls-psearch-label", text: file.label }),
    renderElement("span", { class: "ls-count", text: String(file.matches.length) }),
    actionButton("Replace All in File", "replace-all", replaceFile));
  activateOnEnter(header, () => {
    const open = matches.hidden;
    matches.hidden = !open;
    header.setAttribute("aria-expanded", String(open));
    twistie.innerHTML = renderIcon(open ? "chevron-down" : "chevron-right");
  });
  return header;
}

export function createResultsList(actions: ResultsActions): ResultsList {
  const root = renderElement("ul", { class: "ls-psearch-results", role: "list", "aria-label": "Results" });
  let locations: MatchLocation[] = [];
  let matchRows: HTMLElement[] = [];
  let selected = -1;
  root.addEventListener("keydown", (event) => moveFocus(root, event));

  function fileGroup(file: FileResults): HTMLElement {
    const matches = renderElement("ul", { class: "ls-psearch-matches", role: "list" });
    const header = fileHeader(file, matches, () => actions.replaceFile(file.path));
    for (const match of file.matches) {
      const at: MatchLocation = { path: file.path, line: match.line, column: match.column, length: match.length };
      const row = renderElement("li", { class: "ls-psearch-row ls-psearch-match", tabindex: "-1", title: `${file.label}:${match.line + 1}` },
        renderElement("span", { class: "ls-psearch-preview" }, match.before, renderElement("mark", { class: "ls-psearch-hit", text: match.text }), match.after),
        actionButton("Replace", "replace", () => actions.replace(at)));
      activateOnEnter(row, () => { select(locations.indexOf(at)); actions.open(at); });
      locations.push(at);
      matchRows.push(row);
      matches.append(row);
    }
    return renderElement("li", { class: "ls-psearch-group" }, header, matches);
  }

  function select(index: number): MatchLocation | undefined {
    selected = index;
    matchRows.forEach((row, i) => row.classList.toggle("ls-psearch-current", i === index));
    matchRows[index]?.scrollIntoView({ block: "nearest" });
    return locations[index];
  }

  return {
    root,
    render(results) {
      locations = [];
      matchRows = [];
      selected = -1;
      root.replaceChildren(...results.files.map(fileGroup));
      // INVARIANT: one row is in the tab order, so Tab reaches the list and the arrows walk it.
      root.querySelector<HTMLElement>(ROW)?.setAttribute("tabindex", "0");
    },
    setReplacing: (on) => root.classList.toggle("ls-psearch-replacing", on),
    count: () => locations.length,
    selected: () => selected,
    select,
  };
}
