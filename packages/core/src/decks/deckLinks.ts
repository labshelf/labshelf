// Reads, hashes and updates the source links of deck blocks: figure, equation, table and citation links with fresh, stale or missing state.
import { deriveTextSha256Hex } from "../hash/index.js";
import { removeComments } from "../latex/index.js";
import type { ProjectFormat } from "../writing/project/index.js";
import { applyDeckEdit, type DeckEditResult } from "./deckEdit.js";
import { parseDeck, type DeckBlock, type DeckModel } from "./deckParse.js";

export type DeckLinkKind = "figure" | "eq" | "table" | "cite";

export type DeckLinkState = "fresh" | "stale" | "missing";

export interface DeckLink { block: string; slide: number; kind: DeckLinkKind; target: string; hash: string | null }

export interface DeckLinkSources { readFigure(path: string): Promise<Uint8Array | undefined>; labelSource(label: string): Promise<string | undefined>; citeText(key: string): Promise<string | undefined> }

export interface DeckLinkStatus { state: DeckLinkState; hash?: string; text?: string }

const HASH = /^[0-9a-f]{12}$/;
const REF = /^(figure|eq|table|cite):(\S+)$/;
const LATEX_ENVIRONMENT = /\\(begin|end)\s*\{([^{}]*)\}/g;
const BLANK_LINE = /\n[ \t]*\r?\n/g;

/** The links of every block with a data-source, in source order; blocks with another kind of ref are skipped (the validator reports them). */
export function readDeckLinks(model: DeckModel): DeckLink[] {
  const links: DeckLink[] = [];
  for (const slide of model.slides) {
    for (const block of slide.blocks) {
      const match = block.source ? REF.exec(block.source.ref) : null;
      if (!block.source || !match) continue;
      links.push({ block: block.id, slide: block.slide, kind: match[1] as DeckLinkKind, target: match[2]!, hash: block.source.hash != null && HASH.test(block.source.hash) ? block.source.hash : null });
    }
  }
  return links;
}

/** The trimmed source of a label: the innermost LaTeX environment holding it, or the Typst paragraph up to the label. */
export function findLabelSource(format: ProjectFormat, text: string, label: string): string | undefined {
  return format === "latex" ? findLatexLabelSource(text, label) : findTypstLabelSource(text, label);
}

function findLatexLabelSource(text: string, label: string): string | undefined {
  const code = removeComments(text);
  const at = new RegExp(`\\\\label\\s*\\{${escapeRegExp(label)}\\}`).exec(code)?.index;
  if (at === undefined) return undefined;
  const open: { name: string; from: number }[] = [];
  for (const token of code.matchAll(LATEX_ENVIRONMENT)) {
    const name = token[2]!.trim();
    if (token[1] === "begin") {
      open.push({ name, from: token.index });
      continue;
    }
    let match = open.length - 1;
    while (match >= 0 && open[match]!.name !== name) match--;
    if (match < 0) continue;
    const begin = open[match]!;
    open.length = match;
    const to = token.index + token[0].length;
    if (begin.from < at && at < to) return text.slice(begin.from, to).trim();
  }
  return undefined;
}

function findTypstLabelSource(text: string, label: string): string | undefined {
  const marker = `<${label}>`;
  const at = text.indexOf(marker);
  if (at < 0) return undefined;
  let start = 0;
  for (const blank of text.slice(0, at).matchAll(BLANK_LINE)) start = blank.index + blank[0].length;
  return text.slice(start, at + marker.length).trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The first 12 hex characters of the SHA-256 of the content. */
export async function deckLinkHash(content: string | Uint8Array): Promise<string> {
  return (await deriveTextSha256Hex(content)).slice(0, 12);
}

/** Compares the hash recorded on a link with its current source; a cite link also gives the current text. */
export async function deriveLinkState(link: DeckLink, sources: DeckLinkSources): Promise<DeckLinkStatus> {
  const content = link.kind === "figure" ? await sources.readFigure(link.target) : link.kind === "cite" ? await sources.citeText(link.target) : await sources.labelSource(link.target);
  if (content === undefined) return { state: "missing" };
  const hash = await deckLinkHash(content);
  const state = hash === link.hash ? "fresh" : "stale";
  return link.kind === "cite" && typeof content === "string" ? { state, hash, text: content } : { state, hash };
}

/** Sets data-source-hash on a linked block and, for a cite block, the text of its first leaf; every other byte stays. */
export function updateDeckLink(html: string, block: string, hash: string, text?: string): DeckEditResult {
  const model = parseDeck(html).model;
  if (!model) return { ok: false, error: "The deck has no html element with a body, so it cannot be edited." };
  const target = model.slides.flatMap((slide) => slide.blocks).find((candidate): candidate is DeckBlock => candidate.id === block);
  if (!target) return { ok: false, error: `Unknown block "${block}".` };
  const source = target.source;
  if (!source) return { ok: false, error: `Block "${block}" has no data-source.` };
  if (!HASH.test(hash)) return { ok: false, error: "The hash must be 12 lowercase hex characters." };
  const setsText = text !== undefined && source.ref.startsWith("cite:");
  if (setsText && target.leaves.length === 0) return { ok: false, error: `Block "${block}" has no text leaf 0.` };
  let updated: string;
  if (source.hashRange) updated = html.slice(0, source.hashRange.from) + hash + html.slice(source.hashRange.to);
  else {
    const quoted = html[source.range.from - 1] === '"' || html[source.range.from - 1] === "'";
    const at = quoted ? source.range.to + 1 : source.range.to;
    updated = `${html.slice(0, at)} data-source-hash="${hash}"${html.slice(at)}`;
  }
  return setsText ? applyDeckEdit(updated, { kind: "setText", block, leaf: 0, text }) : { ok: true, html: updated };
}
