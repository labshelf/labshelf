// Changes the terms of a Space's glossary.
import { newShortId } from "../../model/index.js";
import { isNonEmptyString, isOptional, isPage, rawEntryIds } from "../../model/json/index.js";
import type { Glossary, GlossaryTerm } from "../../model/index.js";

export interface TermDraft {
  readonly term: string;
  readonly symbol?: string;
  readonly definition: string;
  readonly source?: { readonly paperId: string; readonly page?: number };
}

function termFrom(draft: TermDraft, id: string, old: GlossaryTerm | undefined): GlossaryTerm {
  if (draft.term.trim() === "") { throw new Error("A term needs a name."); }
  const { symbol, source } = draft;
  if (source !== undefined && !(isNonEmptyString(source.paperId) && isOptional(source.page, isPage))) {
    throw new Error("A term source needs a paper id and a whole page number of at least 1.");
  }
  return {
    id, term: draft.term.trim(), ...(symbol === undefined ? {} : { symbol }), definition: draft.definition,
    ...(source === undefined ? {} : { source: { ...source, extra: old?.source?.extra ?? {} } }),
    extra: old?.extra ?? {},
  };
}

export function withTerm(glossary: Glossary, draft: TermDraft): { glossary: Glossary; value: string } {
  const id = newShortId(new Set([...glossary.terms.map((term) => term.id), ...rawEntryIds(glossary.invalidTerms)]));
  return { glossary: { ...glossary, terms: [...glossary.terms, termFrom(draft, id, undefined)] }, value: id };
}

/** Replaces the term's content; its id and unknown keys stay. */
export function withUpdatedTerm(glossary: Glossary, termId: string, draft: TermDraft): Glossary {
  const old = glossary.terms.find((term) => term.id === termId);
  if (!old) { throw new Error(`Term ${termId} is not in this glossary.`); }
  return { ...glossary, terms: glossary.terms.map((term) => (term.id === termId ? termFrom(draft, termId, old) : term)) };
}

export function withTermRemoved(glossary: Glossary, termId: string): Glossary {
  return { ...glossary, terms: glossary.terms.filter((term) => term.id !== termId) };
}
