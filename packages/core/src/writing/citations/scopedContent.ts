/** What a citation's scope adds to its hover and preview card: the cited passage, the note, the whole abstract or the marks of the cited page (plan editor-cite-popup D6). */

import type { Annotation, PaperRecord } from "../../model/index.js";
import type { ItemFile, ItemSegment } from "../../qmd/item/itemFile.js";
import { findScopeNote, type CitationScope } from "./citationScopes.js";
import { deriveNotePage } from "./citeTargets.js";
import { listQuotableHighlights } from "./quotes.js";

/** A highlight or note on the cited page, as the page block lists it. */
export interface ScopedCitationMark {
  kind: "highlight" | "note";
  text: string;
}

/**
 * `kind` is the scope shown, after a deleted highlight or note fell back to its page or the paper. `body` is the
 * passage, the note or the abstract; `marks` belong to a page scope, whose thumbnail the DOM renders from `page`.
 */
export interface ScopedCitationContent {
  kind: CitationScope["kind"];
  title: string;
  page?: number;
  body?: string;
  marks?: ScopedCitationMark[];
}

const NOTE_LENGTH = 600;
const MARK_LENGTH = 140;

const flat = (text: string): string => text.replace(/\s+/g, " ").trim();
const cut = (text: string, length: number): string => (text.length > length ? `${text.slice(0, length).trimEnd()}…` : text);

function pageContent(page: number, annotations: readonly Annotation[], notes: ItemFile | undefined): ScopedCitationContent {
  const highlights = listQuotableHighlights(annotations).filter((highlight) => highlight.pageNumber === page);
  const noted = (notes?.segments ?? []).filter((segment): segment is ItemSegment => segment.kind === "item" && flat(segment.body) !== "" && deriveNotePage(segment, annotations) === page);
  return {
    kind: "page", title: `Cited page, p. ${page}`, page,
    marks: [
      ...highlights.map((highlight) => ({ kind: "highlight" as const, text: cut(flat(highlight.content), MARK_LENGTH) })),
      ...noted.map((note) => ({ kind: "note" as const, text: cut(flat(note.body), MARK_LENGTH) })),
    ],
  };
}

function paperContent(paper: Pick<PaperRecord, "summary">): ScopedCitationContent {
  const summary = flat(paper.summary ?? "");
  return { kind: "paper", title: "Abstract", ...(summary ? { body: summary } : {}) };
}

/** What the hover shows first for a scoped citation; a highlight or note is read live from `annotations` and `notes`. */
export function deriveScopedCitationContent(
  scope: CitationScope, paper: Pick<PaperRecord, "summary">, annotations: readonly Annotation[], notes: ItemFile | undefined,
): ScopedCitationContent {
  switch (scope.kind) {
    case "paper": return paperContent(paper);
    case "page": return pageContent(scope.page, annotations, notes);
    case "passage": return { kind: "passage", title: `Cited passage, p. ${scope.page}`, page: scope.page, body: scope.text };
    case "highlight": {
      const highlight = annotations.find((annotation) => annotation.id === scope.annotationId);
      if (!highlight) { return pageContent(scope.page, annotations, notes); }
      return { kind: "highlight", title: `Cited passage, p. ${highlight.pageNumber}`, page: highlight.pageNumber, body: highlight.content.trim() };
    }
    case "note": {
      const note = findScopeNote(notes, scope.noteId);
      if (!note) { return scope.page === undefined ? paperContent(paper) : pageContent(scope.page, annotations, notes); }
      const page = deriveNotePage(note, annotations) ?? scope.page;
      return {
        kind: "note", title: page === undefined ? "Cited note" : `Cited note, p. ${page}`,
        ...(page === undefined ? {} : { page }), body: cut(note.body.trim(), NOTE_LENGTH),
      };
    }
  }
}
