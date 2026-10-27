// Reads and writes glossary.json, keeping unknown keys and refusing writes over a file it could not understand.
// CONTRACT: documents/contracts/spaces.md#layout
import { SPACE_FORMAT_VERSION } from "./space.js";
import type { Glossary, GlossaryReadResult, GlossarySource, GlossaryTerm } from "./space.js";
import { isPage } from "./fieldChecks.js";
import { readEntries } from "./readEntries.js";
import { deriveTopLevelReadOnlyReason } from "./readOnlyReason.js";
import { deriveUnknownFields, withUnknownFields } from "./unknownFields.js";
import { isNonEmptyString, isOptional, isRecord, isString } from "../../guards/index.js";

const EMPTY: Glossary = { terms: [], invalidTerms: [], extra: {} };
const GLOSSARY_KEYS = ["version", "terms"];
const TERM_KEYS = ["id", "term", "symbol", "definition", "source"];
const SOURCE_KEYS = ["paperId", "page"];

function parseSource(raw: unknown): GlossarySource | undefined {
  if (!isRecord(raw) || !isNonEmptyString(raw["paperId"]) || !isOptional(raw["page"], isPage)) { return undefined; }
  const page = raw["page"] as number | undefined;
  return { paperId: raw["paperId"], ...(page === undefined ? {} : { page }), extra: deriveUnknownFields(raw, SOURCE_KEYS) };
}

function parseTerm(raw: unknown): GlossaryTerm | string {
  if (!isRecord(raw) || !isNonEmptyString(raw["id"])) { return "missing id"; }
  const { id, term, symbol, definition } = raw;
  if (!isString(term) || !isString(definition) || !isOptional(symbol, isString)) { return "term, definition or symbol is not text"; }
  const source = raw["source"] === undefined ? undefined : parseSource(raw["source"]);
  if (raw["source"] !== undefined && source === undefined) { return "source needs a paperId and an optional page number"; }
  return {
    id, term, ...(symbol === undefined ? {} : { symbol: symbol as string }), definition,
    ...(source === undefined ? {} : { source }), extra: deriveUnknownFields(raw, TERM_KEYS),
  };
}

/** `text` is undefined when the file does not exist, which is an empty glossary. */
export function parseGlossaryFile(text: string | undefined): GlossaryReadResult {
  if (text === undefined) { return { glossary: EMPTY, warnings: [] }; }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { glossary: EMPTY, warnings: [], readOnlyReason: `glossary.json is not valid JSON (${(error as Error).message}); fix it to edit the glossary.` };
  }
  if (!isRecord(raw)) { return { glossary: EMPTY, warnings: [], readOnlyReason: "glossary.json is not a JSON object; fix it to edit the glossary." }; }
  const warnings: string[] = [];
  const terms = readEntries(raw["terms"], "terms", parseTerm, warnings);
  const glossary = { terms: terms.valid, invalidTerms: terms.raw, extra: deriveUnknownFields(raw, GLOSSARY_KEYS) };
  const readOnlyReason = deriveTopLevelReadOnlyReason(raw, "glossary.json");
  return { glossary, warnings, ...(readOnlyReason === undefined ? {} : { readOnlyReason }) };
}

const sourceJson = (source: GlossarySource) => withUnknownFields({ paperId: source.paperId, page: source.page }, source.extra);

const termJson = (term: GlossaryTerm) => withUnknownFields({
  id: term.id, term: term.term, symbol: term.symbol, definition: term.definition,
  source: term.source === undefined ? undefined : sourceJson(term.source),
}, term.extra);

export function serializeGlossaryFile(glossary: Glossary): string {
  const doc = withUnknownFields({ version: SPACE_FORMAT_VERSION, terms: [...glossary.terms.map(termJson), ...glossary.invalidTerms] }, glossary.extra);
  return `${JSON.stringify(doc, null, 2)}\n`;
}
