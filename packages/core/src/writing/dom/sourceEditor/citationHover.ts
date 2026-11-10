// The hover over a cite key of a library paper: its title, byline, venue and status, abstract, highlights, latest notes, and buttons to open the paper and its notes.
import type { Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, type Tooltip } from "@codemirror/view";
import {
  STATUS_LABEL,
  deriveVenue,
  findCiteKeyOccurrences,
  listQuotedHighlights,
  type Annotation,
  type ItemFile,
  type PaperRecord,
  type ProjectFormat,
  type QuotedHighlight,
} from "../../../index.js";
import { renderElement } from "../../../ui/dom/index.js";
import { summarizeNotes } from "./noteGutter.js";
import { createCitedPaperLoader, type CiteTargetDeps } from "./citationTargets.js";

const SUMMARY_CHARS = 200;
const HIGHLIGHT_LIMIT = 3;

export interface CitationHoverContent {
  title: string;
  byline: string;
  meta: string;
  summary: string;
  highlightsLabel: string;
  highlights: readonly QuotedHighlight[];
  notes: readonly string[];
  citedPage: number | undefined;
}

const cut = (text: string, length: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length).trimEnd()}…` : flat;
};

/** What the hover shows of a paper; `citedPage` is the page the citation names, whose highlights come first. */
export function deriveCitationHoverContent(paper: PaperRecord, annotations: readonly Annotation[], notes: ItemFile | undefined, citedPage?: number): CitationHoverContent {
  return {
    title: paper.title,
    byline: [paper.authors?.join(", "), paper.year === undefined ? "" : String(paper.year)].filter(Boolean).join(" · "),
    meta: [deriveVenue(paper), STATUS_LABEL[paper.status]].filter(Boolean).join(" · "),
    summary: paper.summary ? cut(paper.summary, SUMMARY_CHARS) : "",
    highlightsLabel: citedPage === undefined ? "Your highlights" : `Your highlights on p. ${citedPage}`,
    highlights: listQuotedHighlights(annotations, HIGHLIGHT_LIMIT, citedPage),
    // The latest first.
    notes: notes ? summarizeNotes(notes).latest.reverse() : [],
    citedPage,
  };
}

export interface CitationHoverActions {
  openPaper?: ((paperId: string, page?: number) => void) | undefined;
  openNotes?: ((paperId: string) => void) | undefined;
}

export function renderCitationHover(paper: PaperRecord, content: CitationHoverContent, { openPaper, openNotes }: CitationHoverActions): HTMLElement {
  const button = (label: string, run: () => void): HTMLElement => {
    const node = renderElement("button", { type: "button", class: "ls-btn cm-cite-hover-btn", text: label });
    node.addEventListener("click", run);
    return node;
  };
  const actions = [
    openPaper && button(content.citedPage === undefined ? "Open paper" : `Open at p. ${content.citedPage}`, () => openPaper(paper.id, content.citedPage)),
    openNotes && button("Open notes", () => openNotes(paper.id)),
  ].filter((node) => node !== undefined);
  return renderElement("div", { class: "cm-cite-hover" },
    renderElement("div", { class: "cm-cite-hover-title", text: content.title }),
    content.byline && renderElement("div", { class: "cm-cite-hover-muted", text: content.byline }),
    content.meta && renderElement("div", { class: "cm-cite-hover-muted", text: content.meta }),
    content.summary && renderElement("p", { class: "cm-cite-hover-summary", text: content.summary }),
    content.highlights.length > 0 && renderElement("div", { class: "cm-cite-hover-section" },
      renderElement("div", { class: "cm-cite-hover-label", text: content.highlightsLabel }),
      renderElement("ul", {}, ...content.highlights.map((highlight) => renderElement("li", { text: `p. ${highlight.page} — ${cut(highlight.text, 120)}` })))),
    content.notes.length > 0 && renderElement("div", { class: "cm-cite-hover-section" },
      renderElement("div", { class: "cm-cite-hover-label", text: "Latest notes" }),
      renderElement("ul", {}, ...content.notes.map((line) => renderElement("li", { text: line })))),
    actions.length > 0 && renderElement("div", { class: "cm-cite-hover-actions" }, ...actions));
}

export interface CitationHoverDeps extends CiteTargetDeps, CitationHoverActions {}

/** The page a citation names: LaTeX reads it off the occurrence, Typst from the supplement right after `@key` or inside `#cite(...)`. */
function citedPageOf(format: ProjectFormat, cited: { end: number; command: string; page?: number }, line: string): number | undefined {
  if (format === "latex") return cited.page;
  const scope = cited.command.startsWith("#cite") ? cited.command : /^\[[^\]]*/.exec(line.slice(cited.end))?.[0] ?? "";
  const page = /\[\s*pp?\.\s*~?(\d+)/.exec(scope)?.[1];
  return page === undefined ? undefined : Number(page);
}

/** For `hoverTooltip`: null off a library paper's key. */
export function createCitationHoverSource(deps: CitationHoverDeps): (view: EditorView, pos: number) => Promise<Tooltip | null> {
  const load = createCitedPaperLoader(deps);
  return async (view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const column = pos - line.from;
    const cited = findCiteKeyOccurrences(deps.format, line.text).find((occurrence) => column >= occurrence.start && column <= occurrence.end);
    const found = cited && await load(cited.key);
    if (!cited || !found) return null;
    const { paper, annotations, notes } = found;
    const content = deriveCitationHoverContent(paper, annotations, notes, citedPageOf(deps.format, cited, line.text));
    return {
      pos: line.from + cited.start, end: line.from + cited.end, above: true,
      create: () => ({ dom: renderCitationHover(paper, content, deps) }),
    };
  };
}

export const citationHoverTheme = EditorView.theme({
  ".cm-cite-hover": { padding: "var(--ls-space-3)", maxWidth: "32em", fontFamily: "var(--ls-font)", fontSize: "var(--ls-text-sm)", whiteSpace: "normal" },
  ".cm-cite-hover-title": { fontWeight: "bold", color: "var(--ls-fg)" },
  ".cm-cite-hover-muted": { color: "var(--ls-desc)" },
  ".cm-cite-hover-summary": { margin: "var(--ls-space-2) 0 0" },
  ".cm-cite-hover-section": { marginTop: "var(--ls-space-2)" },
  ".cm-cite-hover-label": { color: "var(--ls-section-fg)" },
  ".cm-cite-hover ul": { margin: "var(--ls-space-1) 0 0", paddingLeft: "var(--ls-space-6)", color: "var(--ls-desc)" },
  ".cm-cite-hover li": { overflowWrap: "anywhere" },
  ".cm-cite-hover-actions": { display: "flex", gap: "var(--ls-space-2)", marginTop: "var(--ls-space-3)" },
});

export function createCitationHover(deps: CitationHoverDeps): Extension {
  return [hoverTooltip(createCitationHoverSource(deps)), citationHoverTheme];
}
