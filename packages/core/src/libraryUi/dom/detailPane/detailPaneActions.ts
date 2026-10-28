/**
 * Handles a click on a `data-action` element in the detail pane (paper commands and host actions, copying, search
 * shortcuts, the pane's own toggles).
 */
import { deriveParentDir } from "../../../library/index.js";
import type { AnnotationColor } from "../../../model/index.js";
import { formatAnnotationsMarkdown, formatQuoteWithCitation } from "../../../reader/index.js";
import { createAuthorQuery, createKeywordQuery, type CitationFormat, type DetailsTab } from "../../store/index.js";
import {
  sendCopyRequest, attachPdf, updateTags, askFindBetterPdf, copyCitation, copyText, findPdf, findFixablePapers, runHostFileAction, createTextLayer, removeNote, openPaper, openSource, pickMoveFolder, showPaper,
} from "../flows/index.js";
import { openTagMenu, runHeadMenu } from "./detailHeader.js";
import type { PaneState } from "./paneState.js";
import { QMD_VOCABULARY } from "../../../qmd/dom/index.js";
import { deriveFilteredAnnotations } from "./detailTabs.js";

/** Re-renders the pane; set by the pane when it mounts. */
export type Rerender = () => void;

function ids(pane: PaneState): string[] {
  return [...pane.ctx.store.get().selected];
}

function paper(pane: PaneState) {
  const id = ids(pane)[0];
  return pane.ctx.store.get().papers.find((p) => p.id === id);
}

// Actions on the paper or the selection; returns false when the action is not one of them.
function paperAction(pane: PaneState, a: string, el: HTMLElement): boolean {
  const { ctx } = pane;
  const sel = ids(pane);
  const id = sel[0]!;
  const data = el.dataset;
  switch (a) {
    case "open": openPaper(ctx, data["id"] ?? id, data["page"] ? Number(data["page"]) : undefined); return true;
    case "openExternal": runHostFileAction(ctx, "paper.openExternal", id); return true;
    case "reveal": runHostFileAction(ctx, "paper.reveal", id); return true;
    case "exportAnnotations": runHostFileAction(ctx, "annotations.export", id); return true;
    case "findPdf": findPdf(ctx, id); return true;
    case "findBetterPdf": void askFindBetterPdf(ctx, id); return true;
    case "askAuthor": sendCopyRequest(ctx, id); return true;
    case "attachPdf": attachPdf(ctx, id); return true;
    case "copyCite": copyCitation(ctx, sel, (data["format"] as CitationFormat | undefined) ?? pane.citeFormat); return true;
    case "copyField": copyText(ctx, data["text"] ?? "", data["label"] ?? "text"); return true;
    case "move": void pickMoveFolder(ctx, sel); return true;
    case "removeTag": updateTags(ctx, sel, [], [data["tag"] ?? ""]); return true;
    case "makeSearchable": createTextLayer(ctx, findFixablePapers(ctx, sel)); return true;
    case "openRelated": showPaper(ctx, data["id"] ?? ""); return true;
    case "selectOnly": ctx.store.selectOnly(data["id"] ?? ""); return true;
    case "openSource": openSource(ctx, data["project"] ?? "", data["file"] ?? "", Number(data["line"] ?? 0)); return true;
    default: return false;
  }
}

// Clicks that narrow the list to papers like this one.
function searchAction(pane: PaneState, a: string, el: HTMLElement): boolean {
  if (a === "searchTag") { pane.ctx.store.searchTag(el.dataset["tag"] ?? ""); return true; }
  const query = a === "searchAuthor" ? createAuthorQuery(el.dataset["q"] ?? "")
    : a === "searchKeyword" ? createKeywordQuery(el.dataset["keyword"] ?? "")
    : null;
  if (query === null) {
    if (a !== "goFolder") return false;
    const p = paper(pane);
    if (p) pane.ctx.store.openFolder(deriveParentDir(p.path, "/"));
    return true;
  }
  pane.ctx.store.set({ query });
  return true;
}

function annotationAction(pane: PaneState, a: string, el: HTMLElement, rerender: Rerender): boolean {
  const p = paper(pane);
  const details = p ? pane.ctx.store.get().details[p.id] : undefined;
  if (!p || !details) return a === "annColor" || a === "copyAnnotation" || a === "copyAnnotations" || a === "insertHighlights";
  switch (a) {
    case "annColor": {
      const color = el.dataset["color"] as AnnotationColor;
      pane.annColor = pane.annColor === color ? null : color;
      rerender();
      return true;
    }
    case "copyAnnotation": {
      const ann = details.annotations.find((x) => x.id === el.dataset["id"]);
      if (ann) copyText(pane.ctx, formatQuoteWithCitation(ann.content, p, ann.pageNumber, "author-year"), "quote");
      return true;
    }
    case "copyAnnotations": {
      const shown = deriveFilteredAnnotations(pane, details.annotations);
      copyText(pane.ctx, formatAnnotationsMarkdown(p, shown), `${shown.length} annotation${shown.length === 1 ? "" : "s"}`);
      return true;
    }
    case "insertHighlights": insertHighlights(pane, formatAnnotationsMarkdown(p, details.annotations.filter((x) => x.type === "highlight"))); return true;
    default: return false;
  }
}

function insertHighlights(pane: PaneState, markdown: string): void {
  const id = ids(pane)[0];
  if (id) pane.notes.append(id, markdown);
}

// The pane's own toggles and choices.
function paneAction(pane: PaneState, a: string, el: HTMLElement, rerender: Rerender): boolean {
  const { ctx } = pane;
  switch (a) {
    case "tab": pane.tab = el.dataset["tab"] as DetailsTab; ctx.prefs.save({ detailTab: pane.tab }); break;
    case "citeFormat": pane.citeFormat = el.dataset["format"] as CitationFormat; ctx.prefs.save({ citeFormat: pane.citeFormat }); break;
    case "toggleAbstract": pane.abstractOpen = !pane.abstractOpen; break;
    case "toggleAuthors": pane.authorsOpen = !pane.authorsOpen; break;
    case "addTag": pane.tagEditing = true; break;
    case "pickTag": openTagMenu(ctx, el); return true;
    case "copyAbstract": copyText(ctx, paper(pane)?.summary ?? "", "abstract"); return true;
    case "copyNote": { const p = paper(pane); if (p) copyText(ctx, pane.notes.text(p.id), QMD_VOCABULARY.item); return true; }
    case "removeNote": { const id = ids(pane)[0]; if (id) removeNote(ctx, id, el.dataset["item"] ?? ""); return true; }
    case "editNote": pane.tab = "notes"; ctx.prefs.save({ detailTab: "notes" }); rerender(); pane.notes.focusNew(); return true;
    default: return false;
  }
  rerender();
  return true;
}

/** Runs the action of a clicked `data-action` element. */
export function runDetailsAction(pane: PaneState, el: HTMLElement, rerender: Rerender): void {
  const a = el.dataset["action"] ?? "";
  if (runHeadMenu(pane, a, el) || paperAction(pane, a, el) || searchAction(pane, a, el) || paneAction(pane, a, el, rerender)) return;
  annotationAction(pane, a, el, rerender);
}
