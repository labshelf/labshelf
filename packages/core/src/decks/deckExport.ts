// Deck export: one offline HTML file from deck.html with assets and fonts as data URIs, the theme inlined, math pre-rendered, keyboard navigation and `#print`.
import { bytesToBase64 } from "../encoding/base64.js";
import { escapeHtml } from "../ui/htmlSafety.js";
import { cssReferences, tagReferences, type AssetReference } from "./deckAssetRefs.js";
import { deckBaseCss, deckPrintCss } from "./deckLayoutCss.js";
import { parseDeck } from "./deckParse.js";
import { tokenizeDeckHtml, type DeckRange, type DeckToken } from "./deckTokens.js";
import { validateDeck } from "./deckValidate.js";

export interface DeckExportOptions { theme: string; readAsset(path: string): Promise<Uint8Array | undefined>; renderMath?: (tex: string, display: boolean) => string }

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", avif: "image/avif",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", pdf: "application/pdf",
};

/** The mime type of an asset by its lowercase extension; application/octet-stream when unknown. */
export function deckAssetMime(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

interface Splice { from: number; to: number; text: string }

interface MathElement { startTag: DeckRange; content: DeckRange; tex: string; display: boolean }

/** The asset references of the deck source and its outermost data-math elements, in source order. */
function scanDeck(html: string, tokens: DeckToken[]): { references: AssetReference[]; math: MathElement[] } {
  const references: AssetReference[] = [];
  const math: MathElement[] = [];
  let open: { name: string; depth: number; element: MathElement } | null = null;
  let previous: DeckToken | undefined;
  for (const token of tokens) {
    if (token.kind === "start") {
      tagReferences(html, token.name, token.attributes, references);
      if (open && token.name === open.name && !token.selfClosing) open.depth++;
      else if (!open && !token.selfClosing) {
        const attribute = token.attributes.find((a) => a.name === "data-math");
        if (attribute) open = { name: token.name, depth: 0, element: { startTag: token.range, content: { from: token.range.to, to: token.range.to }, tex: "", display: attribute.value?.trim().toLowerCase() === "display" } };
      }
    } else if (token.kind === "end") {
      if (open && token.name === open.name && open.depth-- === 0) {
        open.element.content = { from: open.element.content.from, to: token.range.from };
        math.push(open.element);
        open = null;
      }
    } else if (token.kind === "text") {
      if (open) open.element.tex += token.text;
      if (token.raw && previous?.kind === "start" && previous.name === "style") cssReferences(html, token.range.from, token.text, references);
    }
    previous = token;
  }
  return { references, math };
}

/** Reads each asset once, in first-reference order; a path without bytes maps to undefined. */
async function readDataUris(paths: string[], readAsset: DeckExportOptions["readAsset"]): Promise<Map<string, string | undefined>> {
  const uris = new Map<string, string | undefined>();
  for (const path of paths) {
    if (uris.has(path)) continue;
    const bytes = await readAsset(path);
    uris.set(path, bytes ? `data:${deckAssetMime(path)};base64,${bytesToBase64(bytes)}` : undefined);
  }
  return uris;
}

/** Applies non-overlapping splices to a text. */
function applySplices(text: string, splices: Splice[]): string {
  let out = "";
  let at = 0;
  for (const splice of [...splices].sort((a, b) => a.from - b.from)) {
    out += text.slice(at, splice.from) + splice.text;
    at = splice.to;
  }
  return out + text.slice(at);
}

const inside = (range: DeckRange, outer: DeckRange): boolean => range.from >= outer.from && range.to <= outer.to;

/** The theme with each url() reference inlined. */
async function inlineTheme(theme: string, readAsset: DeckExportOptions["readAsset"]): Promise<string> {
  const references: AssetReference[] = [];
  cssReferences(theme, 0, theme, references);
  const uris = await readDataUris(references.map((reference) => reference.path), readAsset);
  return applySplices(theme, references.flatMap(({ range, path }) => {
    const uri = uris.get(path);
    return uri === undefined ? [] : [{ ...range, text: uri }];
  }));
}

/** The math splices: the rendered output replaces the content and the TeX goes into a data-tex attribute; none when rendering fails. */
function mathSplices(html: string, element: MathElement, renderMath: NonNullable<DeckExportOptions["renderMath"]>): Splice[] {
  let rendered: string;
  try {
    rendered = renderMath(element.tex, element.display);
  } catch {
    return [];
  }
  const tagEnd = html.slice(element.startTag.from, element.startTag.to).endsWith("/>") ? element.startTag.to - 2 : element.startTag.to - 1;
  return [
    { from: tagEnd, to: tagEnd, text: ` data-tex="${escapeHtml(element.tex)}"` },
    { from: element.content.from, to: element.content.to, text: rendered },
  ];
}

// INVARIANT: no `//` anywhere (no comments, no URLs) and under 2 KB; the export test checks both.
const RUNTIME = [
  "(function(){var d=document,w=window,l=location,S=[].slice.call(d.querySelectorAll(\"[data-slide]\")),n=S.length,i=0;",
  "if(l.hash==\"#print\"){w.addEventListener(\"load\",function(){w.print()});return}",
  "var c=d.createElement(\"style\");",
  "c.textContent=\"@media screen{html,body{height:100%;overflow:hidden;background:#000}[data-slide]{position:absolute;left:0;top:0;transform-origin:0 0}}",
  "@media print{[data-slide]{display:block!important;position:relative!important;transform:none!important}}\";",
  "d.head.appendChild(c);",
  "function show(){i=Math.max(0,Math.min(n-1,i));S.forEach(function(e,j){e.style.display=j==i?\"\":\"none\"});var e=S[i];if(!e)return;",
  "var W=e.offsetWidth,H=e.offsetHeight,f=Math.min(w.innerWidth/W,w.innerHeight/H);",
  "e.style.transform=\"translate(\"+(w.innerWidth-W*f)/2+\"px,\"+(w.innerHeight-H*f)/2+\"px) scale(\"+f+\")\"}",
  "function read(){var m=/^#(\\d+)$/.exec(l.hash);if(m)i=m[1]-1}",
  "read();show();w.addEventListener(\"resize\",show);w.addEventListener(\"hashchange\",function(){read();show()});",
  "d.addEventListener(\"keydown\",function(e){var k=e.key,j=i;",
  "if(k==\"ArrowRight\"||k==\"ArrowDown\"||k==\" \"||k==\"Spacebar\"||k==\"PageDown\")j++;",
  "else if(k==\"ArrowLeft\"||k==\"ArrowUp\"||k==\"PageUp\")j--;",
  "else if(k==\"Home\")j=0;else if(k==\"End\")j=n-1;else return;",
  "e.preventDefault();j=Math.max(0,Math.min(n-1,j));if(j!=i){i=j;show()}l.hash=\"#\"+(i+1)})})();",
].join("");

/** Exports deck.html as one offline HTML file; rejects when validateDeck finds an error in the deck or theme. */
export async function exportDeckHtml(html: string, options: DeckExportOptions): Promise<string> {
  const errors = validateDeck(html, { theme: options.theme }).filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => diagnostic.code);
  if (errors.length > 0) throw new Error(`The deck has errors: ${[...new Set(errors)].join(", ")}.`);
  const { model } = parseDeck(html);
  if (!model?.size || !model.themeLink) throw new Error("The deck has errors: DECK001.");
  const { references, math } = scanDeck(html, tokenizeDeckHtml(html).tokens);
  const themeLink = model.themeLink;
  const replaced = [themeLink, ...(options.renderMath ? math.map((element) => element.content) : [])];
  const kept = references.filter((reference) => !replaced.some((range) => inside(reference.range, range)));
  const uris = await readDataUris(kept.map((reference) => reference.path), options.readAsset);
  const theme = await inlineTheme(options.theme, options.readAsset);
  const splices: Splice[] = [];
  for (const { range, path } of kept) {
    const uri = uris.get(path);
    if (uri !== undefined) splices.push({ ...range, text: uri });
  }
  if (options.renderMath) for (const element of math) splices.push(...mathSplices(html, element, options.renderMath));
  const styles = `<style data-deck-base>${deckBaseCss(model.size)}\n${deckPrintCss(model.size)}</style><style data-deck-theme>${theme}</style>`;
  splices.push({ ...themeLink, text: styles });
  splices.push({ from: model.bodyContentRange.to, to: model.bodyContentRange.to, text: `<script data-deck-runtime>${RUNTIME}</script>` });
  return applySplices(html, splices);
}
