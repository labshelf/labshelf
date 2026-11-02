// The share link of a deck as a QR code: the SVG for the deck's assets folder and the image block that shows it on a slide.
import { applyDeckEdit } from "../decks/deckEdit.js";
import { parseDeck } from "../decks/deckParse.js";
import { deckCanvasPx } from "../decks/deckSizes.js";
import { encodeQr, formatQrSvg } from "../qr/index.js";
import type { ShareLinkView } from "./libraryShareHost.js";
import { deriveShareLinkOfEntry, type ShareEntry } from "./shareFlows.js";

export interface ShareQrInsert { svgPath: string; svg: string; html: string }

const SVG_PATH = "assets/share-qr.svg";
const BLOCK_ID = "share-qr";
/** The QR side is this share of the canvas' shorter side, and the corner margin is MARGIN_SHARE of it. */
const SIDE_SHARE = 0.2;
const MARGIN_SHARE = 0.04;

/** The text of the deck's `<title>`, else `fallback` (the deck folder's name). */
export function deckTitleOf(html: string, fallback: string): string {
  const match = /<title>([^<]*)<\/title>/i.exec(html);
  const text = match?.[1]?.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
  return text ? text : fallback;
}

/** The link of the newest deck entry whose folder is `title`, else undefined. */
export function findDeckShareLink(shares: readonly ShareEntry[], title: string): string | undefined {
  let newest: ShareEntry | undefined;
  for (const entry of shares) {
    if (entry.kind !== "deck" || entry.folder !== title) { continue; }
    if (!newest || entry.createdAt > newest.createdAt) { newest = entry; }
  }
  return newest ? deriveShareLinkOfEntry(newest) : undefined;
}

/** The newest (by createdAt) shared link whose kind is deck and whose folder is `title`, else undefined. */
export function newestDeckLink(links: readonly ShareLinkView[], title: string): ShareLinkView | undefined {
  let newest: ShareLinkView | undefined;
  for (const view of links) {
    if (view.kind !== "deck" || view.folder !== title) { continue; }
    if (!newest || view.createdAt > newest.createdAt) { newest = view; }
  }
  return newest;
}

/** Adds the QR image block at the bottom-right corner of `slide`; the SVG is for the caller to write at `svgPath`. */
export function insertShareQr(html: string, link: string, slide: number): { ok: true; insert: ShareQrInsert } | { ok: false; error: string } {
  const model = parseDeck(html).model;
  if (!model?.size) { return { ok: false, error: "The deck has no valid size, so the QR code cannot be placed." }; }
  let svg: string;
  try {
    svg = formatQrSvg(encodeQr(link), { margin: 4 });
  } catch (error) {
    return { ok: false, error: `The share link is too long for a QR code: ${String(error instanceof Error ? error.message : error)}` };
  }
  const taken = new Set(model.slides.flatMap((candidate) => candidate.blocks.map((block) => block.id)));
  let id = BLOCK_ID;
  for (let n = 2; taken.has(id); n += 1) { id = `${BLOCK_ID}-${String(n)}`; }
  const { width, height } = deckCanvasPx(model.size);
  const shorter = Math.min(width, height);
  const side = Math.round(shorter * SIDE_SHARE);
  const margin = shorter * MARGIN_SHARE;
  const left = Math.round(width - side - margin);
  const top = Math.round(height - side - margin);
  const block = `<div data-block="${id}" style="left: ${String(left)}px; top: ${String(top)}px; width: ${String(side)}px; height: ${String(side)}px;"><img src="${SVG_PATH}" alt="QR code of the share link"></div>`;
  const edited = applyDeckEdit(html, { kind: "addBlock", slide, html: block });
  if (!edited.ok) { return { ok: false, error: edited.error }; }
  return { ok: true, insert: { svgPath: SVG_PATH, svg, html: edited.html } };
}
