// The note outline (plan notebook-flow D15): the headings, code cells and figures of every item of a note in order, with a cell's problem badges,
// and choosing an entry jumps to its block. The entries of one editor come from its handle's outline(); the jump is its reveal(pos).
import type { Node as ProseNode } from "prosemirror-model";
import { NodeSelection, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { createDebouncer } from "../../async/index.js";
import { renderElement } from "../../ui/dom/index.js";
import { renderIcon, type IconName } from "../../ui/icons/index.js";
import { cellLanguageLabel } from "../compute/index.js";
import { readOutputImage, readOutputPlot } from "../item/index.js";
import { foldStateOf, setFold } from "./foldPlugin.js";
import { fenceCellLanguage } from "./inlineViews.js";
import type { NoteBarEditor } from "./noteBar.js";
import { scanDoc } from "./notebookCells.js";
import { outputContent } from "./outputView.js";
import { outputProblem, type OutputProblem } from "./problemNav.js";
import { cellGroup } from "./qmdBlocks.js";

/** One line of the outline: a heading (level = its heading level), a code cell or a figure (level 0), at the top-level position of its block. */
export interface OutlineEntry { readonly kind: "heading" | "cell" | "figure"; readonly pos: number; readonly level: number; readonly label: string; readonly badges: readonly ("error" | "out-of-date" | "maybe-stale")[] }

/** Fired (bubbling, composed) from an editor's root when what its outline shows may have changed: its document, or a class of an output's view. */
export const OUTLINE_CHANGE_EVENT = "qmd-outline-change";

const REFRESH_DELAY_MS = 200;
const CODE_CHARS = 60;
const BADGES: Readonly<Record<OutputProblem, { text: string; icon: IconName }>> = {
  error: { text: "Error", icon: "warning" },
  "out-of-date": { text: "Out of date", icon: "refresh" },
  "maybe-stale": { text: "May be out of date", icon: "info" },
};
const BADGE_ORDER: readonly OutputProblem[] = ["error", "out-of-date", "maybe-stale"];

/** '<Language> cell · <first non-empty code line>', the line cut to 60 characters. */
function cellLabel(node: ProseNode): string {
  const lang = node.attrs.lang as string | null;
  const language = fenceCellLanguage(lang);
  const name = language ? cellLanguageLabel(language) : lang ? lang : "Code";
  const line = (node.attrs.code as string).split(/\r\n|\n|\r/).map((text) => text.trim()).find((text) => text !== "");
  if (line === undefined) return `${name} cell`;
  return `${name} cell · ${line.length > CODE_CHARS ? `${line.slice(0, CODE_CHARS)}…` : line}`;
}

/** The figure an output shows: '2D plot' or '3D plot' for a plot result, 'Image' for an image; null for any other output. */
function figureLabel(raw: string): string | null {
  const content = outputContent(raw);
  const plot = readOutputPlot(content);
  if (plot) return plot.spec.dim === 3 ? "3D plot" : "2D plot";
  return readOutputImage(content) ? "Image" : null;
}

/** The outline of one editor in document order: headings, code cells with the problems of their outputs, plot and image outputs and drawings. */
export function outlineOf(view: EditorView): readonly OutlineEntry[] {
  if (view.isDestroyed) return [];
  const { doc } = view.state;
  const entries: OutlineEntry[] = [];
  doc.forEach((node, pos) => {
    switch (node.type.name) {
      case "heading":
        entries.push({ kind: "heading", pos, level: node.attrs.level as number, label: node.textContent, badges: [] });
        return;
      case "code_cell": {
        const { to } = cellGroup(doc, pos);
        const found = new Set<OutputProblem>();
        for (let at = pos + node.nodeSize; at < to; at += doc.nodeAt(at)!.nodeSize) {
          const problem = outputProblem(view, at);
          if (problem) found.add(problem);
        }
        entries.push({ kind: "cell", pos, level: 0, label: cellLabel(node), badges: BADGE_ORDER.filter((problem) => found.has(problem)) });
        return;
      }
      case "output": {
        const label = figureLabel(node.attrs.raw as string);
        if (label) entries.push({ kind: "figure", pos, level: 0, label, badges: [] });
        return;
      }
      case "drawing":
        entries.push({ kind: "figure", pos, level: 0, label: "Diagram", badges: [] });
        return;
      default:
    }
  });
  return entries;
}

/**
 * Shows the top-level block at `pos`: expands the collapsed cell holding it and every collapsed section around it, selects it (a heading gets the caret
 * at its start), scrolls it into view and focuses the editor. Never changes the document.
 */
export function revealBlockIn(view: EditorView, pos: number): void {
  if (view.isDestroyed) return;
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  const { cells, headings } = scanDoc(view.state.doc);
  const cell = cells.find((candidate) => candidate.pos === cellGroup(view.state.doc, pos).from);
  if (cell && foldStateOf(view.state).cells.has(cell.key)) setFold(view, { cell: [cell.key, false] });
  let around: { key: string; level: number }[] = [];
  for (const heading of headings) {
    if (heading.pos >= pos) break;
    around = [...around.filter((outer) => outer.level < heading.level), heading];
  }
  if (node.type.name === "heading") around = around.filter((outer) => outer.level < (node.attrs.level as number));
  for (const section of around) if (foldStateOf(view.state).sections.has(section.key)) setFold(view, { section: [section.key, false] });
  const { doc } = view.state;
  const selection = node.isTextblock ? TextSelection.create(doc, pos + 1) : NodeSelection.create(doc, pos);
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  view.focus();
}

function renderBadge(problem: OutputProblem): HTMLElement {
  const { text, icon } = BADGES[problem];
  return renderElement("span", { class: `qmd-outline-badge is-${problem}` },
    renderElement("span", { class: "qmd-outline-badge-icon", html: renderIcon(icon), "aria-hidden": "true" }), text);
}

/**
 * Renders into `host` the outline of `editors()` in their order: a list of buttons, one per entry, headings indented by level. ArrowUp / ArrowDown move
 * the focus between entries; Enter or a click asks that entry's editor to reveal its position. It renders at once; refresh() re-reads the editors 200 ms
 * later, as does a change in any editor, and never moves the focus out of where it is.
 */
export function renderNoteOutline(host: HTMLElement, editors: () => readonly NoteBarEditor[]): { refresh(): void; destroy(): void } {
  const list = renderElement("div", { class: "qmd-outline", role: "list", "aria-label": "Outline" });
  let shown = "";

  const buttons = (): HTMLButtonElement[] => [...list.querySelectorAll<HTMLButtonElement>(".qmd-outline-entry")];

  function render(): void {
    const rows = editors().flatMap((editor) => editor.handle.outline().map((entry) => ({ editor, entry })));
    const signature = JSON.stringify(rows.map(({ editor, entry }) => [editor.itemId, entry]));
    if (signature === shown) return;
    shown = signature;
    const focused = buttons().indexOf(document.activeElement as HTMLButtonElement);
    list.replaceChildren(...rows.map(({ editor, entry }) => {
      const button = renderElement("button", { class: `qmd-outline-entry is-${entry.kind} is-level-${entry.level}`, type: "button" },
        renderElement("span", { class: "qmd-outline-label" }, entry.label), ...entry.badges.map(renderBadge));
      button.addEventListener("click", () => editor.handle.reveal(entry.pos));
      return renderElement("div", { class: "qmd-outline-item", role: "listitem" }, button);
    }));
    // A rebuild keeps the focus on the same row when it sat in the outline, and leaves it alone anywhere else.
    if (focused !== -1) buttons()[Math.min(focused, buttons().length - 1)]?.focus();
  }

  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
    const all = buttons();
    const index = all.indexOf(event.target as HTMLButtonElement);
    if (index === -1) return;
    event.preventDefault();
    if (event.key === "Enter") { all[index]!.click(); return; }
    all[Math.max(0, Math.min(all.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]!.focus();
  });

  const later = createDebouncer(render, REFRESH_DELAY_MS);
  const onChange = (): void => later.call();
  const doc = host.ownerDocument;
  doc.addEventListener(OUTLINE_CHANGE_EVENT, onChange);
  render();
  host.append(list);
  return {
    refresh: () => later.call(),
    destroy() {
      later.cancel();
      doc.removeEventListener(OUTLINE_CHANGE_EVENT, onChange);
      list.remove();
    },
  };
}
