/**
 * What a click on a `data-action` element in the detail pane does: paper commands and host actions, copying, search
 * shortcuts, and the pane's own toggles (tab, citation style, folds, annotation filters, note tools).
 */
import { parentDir } from "../../../library/index.js";
import type { AnnotationColor, PaperStatus } from "../../../model/index.js";
import { formatAnnotationsMarkdown, formatQuoteWithCitation } from "../../../reader/index.js";
import { authorQuery, keywordQuery, tagQuery } from "../../searchQueries.js";
import type { CiteFormat, DetailTab } from "../../state/index.js";
import {
  attachPdf, changeTags, copyCitation, copyText, findPdf, fixableIds, hostFileAction, makeSearchable, openPaper,
  pickMoveTarget, revealPaper, setPaperStatus,
} from "../flows/index.js";
import { showPaperMenu } from "../menu/index.js";
import type { PaneState } from "./paneState.js";
import { filteredAnnotations } from "./tabs/index.js";

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
    case "openExternal": hostFileAction(ctx, "paper.openExternal", id); return true;
    case "reveal": hostFileAction(ctx, "paper.reveal", id); return true;
    case "exportAnnotations": hostFileAction(ctx, "annotations.export", id); return true;
    case "findPdf": findPdf(ctx, id); return true;
    case "attachPdf": attachPdf(ctx, id); return true;
    case "copyKey": copyCitation(ctx, sel, "key"); return true;
    case "copyCite": copyCitation(ctx, sel, (data["format"] as CiteFormat | undefined) ?? pane.citeFormat); return true;
    case "copyField": copyText(ctx, data["text"] ?? "", data["label"] ?? "text"); return true;
    case "move": void pickMoveTarget(ctx, sel); return true;
    case "more": showPaperMenu(ctx, el); return true;
    case "setStatus": setPaperStatus(ctx, sel, data["status"] as PaperStatus); return true;
    case "removeTag": changeTags(ctx, sel, [], [data["tag"] ?? ""]); return true;
    case "makeSearchable": makeSearchable(ctx, fixableIds(ctx, sel)); return true;
    case "openRelated": revealPaper(ctx, data["id"] ?? ""); return true;
    case "selectOnly": ctx.store.selectOnly(data["id"] ?? ""); return true;
    default: return false;
  }
}

// Clicks that narrow the list to papers like this one.
function searchAction(pane: PaneState, a: string, el: HTMLElement): boolean {
  const query = a === "searchTag" ? tagQuery(el.dataset["tag"] ?? "")
    : a === "searchAuthor" ? authorQuery(el.dataset["q"] ?? "")
    : a === "searchKeyword" ? keywordQuery(el.dataset["keyword"] ?? "")
    : null;
  if (query === null) {
    if (a !== "goFolder") return false;
    const p = paper(pane);
    if (p) pane.ctx.store.openFolder(parentDir(p.path, "/"));
    return true;
  }
  pane.ctx.store.set({ status: "all", query });
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
      const shown = filteredAnnotations(pane, details.annotations);
      copyText(pane.ctx, formatAnnotationsMarkdown(p, shown), `${shown.length} annotation${shown.length === 1 ? "" : "s"}`);
      return true;
    }
    case "insertHighlights": insertHighlights(pane, formatAnnotationsMarkdown(p, details.annotations.filter((x) => x.type === "highlight"))); return true;
    default: return false;
  }
}

function insertHighlights(pane: PaneState, markdown: string): void {
  const input = pane.el.querySelector<HTMLTextAreaElement>(".note-input");
  const id = ids(pane)[0];
  if (!input || !id) return;
  input.value = (input.value.trim() ? `${input.value.replace(/ +$/, "")}\n\n` : "") + markdown;
  pane.notes.changed(id, input.value);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.scrollTop = input.scrollHeight;
}

// The pane's own toggles and choices.
function paneAction(pane: PaneState, a: string, el: HTMLElement, rerender: Rerender): boolean {
  const { ctx } = pane;
  switch (a) {
    case "tab": pane.tab = el.dataset["tab"] as DetailTab; ctx.prefs.save({ detailTab: pane.tab }); break;
    case "citeFormat": pane.citeFormat = el.dataset["format"] as CiteFormat; ctx.prefs.save({ citeFormat: pane.citeFormat }); break;
    case "toggleAbstract": pane.abstractOpen = !pane.abstractOpen; break;
    case "toggleAuthors": pane.authorsOpen = !pane.authorsOpen; break;
    case "copyAbstract": copyText(ctx, paper(pane)?.summary ?? "", "abstract"); return true;
    case "copyNote": { const p = paper(pane); if (p) copyText(ctx, pane.notes.text(p).trim() ? pane.notes.text(p) : "", "note"); return true; }
    default: return false;
  }
  rerender();
  return true;
}

/** Runs the action of a clicked `data-action` element. */
export function runDetailAction(pane: PaneState, el: HTMLElement, rerender: Rerender): void {
  const a = el.dataset["action"] ?? "";
  if (paperAction(pane, a, el) || searchAction(pane, a, el) || paneAction(pane, a, el, rerender)) return;
  annotationAction(pane, a, el, rerender);
}
