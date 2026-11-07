/**
 * Validates deck.html (and optionally its theme.css and file list) against the deck rules DECK001 to DECK025: pure, deterministic, sorted diagnostics with location and fix hint.
 */
import { parseDeck, type DeckBlock, type DeckModel } from "./deckParse.js";
import { deckCanvasPx, isDeckSizeAllowed } from "./deckSizes.js";
import { classifyReference, escapesFolder, findCssUrls, findHeavyCss, readSrcset } from "./deckValidateCss.js";
import { deckLineColumn, tokenizeDeckHtml, type DeckAttribute, type DeckRange, type DeckToken } from "./deckTokens.js";
import { readThemeProperties } from "./themeCss.js";
import { isDeckChartModel, readDeckChart } from "./deckCharts.js";

export type DeckSeverity = "error" | "warning";

export interface DeckDiagnostic { code: string; severity: DeckSeverity; slide?: number; block?: string; file?: "theme.css"; line: number; column: number; message: string; hint: string }

export interface DeckRule { code: string; severity: DeckSeverity; summary: string; hint: string }

export interface DeckValidateOptions { theme?: string; files?: ReadonlySet<string> }

const RULES: ReadonlyArray<readonly [DeckSeverity, string, string]> = [
  ["error", "The root html element, its body, or a data-deck of talk or poster is missing.", "Give the html element data-deck=\"talk\" or data-deck=\"poster\" and a body."],
  ["error", "data-deck-version is missing or not 1.", "Set data-deck-version=\"1\" on the html element."],
  ["error", "data-deck-size is missing, malformed or outside the range for the deck kind.", "Set data-deck-size to <w>x<h>px (320 to 7680) for a talk or <w>x<h>mm or in (100 to 2000 mm) for a poster."],
  ["error", "The size unit does not fit the deck kind.", "Use px for a talk and mm or in for a poster."],
  ["error", "The body holds no slide.", "Add a <section data-slide> as a direct child of body."],
  ["error", "A poster has more than one slide.", "Keep a poster to one slide; move the content into its blocks."],
  ["error", "An element with data-slide is not a section that is a direct child of body.", "Make each slide a <section data-slide> directly in body."],
  ["error", "The theme link is missing, repeated, outside head or not a stylesheet link to theme.css.", "Keep one <link rel=\"stylesheet\" href=\"theme.css\" data-deck-theme> in head."],
  ["error", "An element with data-block is not a direct child of a slide or sits inside another block.", "Place each block directly in its slide's section, never inside another block."],
  ["error", "A block id is invalid or repeats an earlier one.", "Give each block a unique id of lowercase letters, digits and hyphens, starting with a letter, at most 40 characters."],
  ["error", "A block's left, top, width or height is missing, not in px with at most 2 decimals, or a negative size.", "Give the block an inline style with left, top, width and height in px."],
  ["warning", "A block's rect leaves the slide canvas.", "Move or resize the block so it lies inside the slide."],
  ["error", "A script element, an on* attribute or a javascript: URL.", "Remove the script, event handler attribute or javascript: URL."],
  ["error", "An iframe, object, embed, frame, frameset, form or base element, or a meta refresh.", "Remove the embedding, form, base or refresh element."],
  ["error", "An asset reference is absolute, remote, protocol-relative or leaves the deck folder.", "Copy the asset into the deck folder and reference it by a relative path."],
  ["warning", "A relative asset reference names a file that is not in the deck.", "Add the missing file to the deck folder or fix the reference."],
  ["error", "A slide has more than one notes element, or notes are not a direct child of a slide.", "Keep one <aside data-notes> directly in each slide."],
  ["warning", "A poster holds speaker notes.", "Remove the notes from the poster."],
  ["error", "A math element has unbalanced braces.", "Balance the { and } in the TeX, escaping literal braces as \\{ and \\}."],
  ["error", "A data-source is misplaced or malformed, or its data-source-hash is not 12 lowercase hex.", "Put data-source=\"figure:|eq:|table:|cite:<ref>\" on a block with a 12-hex data-source-hash."],
  ["warning", "A linked block has no data-source-hash.", "Add data-source-hash with the source's current hash."],
  ["warning", "Heavy CSS: backdrop-filter, filter in @keyframes or a transition of filter.", "Drop backdrop-filter and animated filters; use opacity or transform instead."],
  ["error", "The markup is malformed.", "Close every element, quote and comment, and drop duplicate attributes and stray end tags."],
  ["warning", "The theme's first :root rule has no custom property.", "Declare the deck's custom properties in a :root rule at the top of theme.css."],
  ["warning", "A chart block's data-chart is not JSON of an object whose v is 1.", "Reinsert the chart from the figure editor, or restore its data-chart from a saved copy."],
];

const codeOf = (index: number): string => `DECK${String(index + 1).padStart(3, "0")}`;

/** The 25 deck rules in code order; a fresh array each call. */
export function listDeckRules(): DeckRule[] {
  return RULES.map(([severity, summary, hint], index) => ({ code: codeOf(index), severity, summary, hint }));
}

const RULE_BY_CODE = new Map(RULES.map((rule, index) => [codeOf(index), rule] as const));

interface Finding { code: string; offset: number; message: string; theme: boolean }

interface ElementInfo { name: string; attributes: DeckAttribute[]; tag: DeckRange; parent: ElementInfo | null; inHead: boolean; math?: string }

interface Walk { elements: ElementInfo[]; styles: Array<{ css: string; from: number }> }

/** Same as the parser's void elements, so the walk's ancestry matches the model's tree. */
const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const EMBEDDING = new Set(["iframe", "object", "embed", "frame", "frameset", "form", "base"]);
const BLOCK_ID = /^[a-z][a-z0-9-]{0,39}$/;
const RECT_VALUE = /^-?\d+(\.\d{1,2})?px$/;
const SOURCE_VALUE = /^(figure|eq|table|cite):(\S+)$/;
const SOURCE_HASH = /^[0-9a-f]{12}$/;
/** The value without ASCII whitespace and control characters, lowercased: what a browser reads as the scheme. */
const stripUrlNoise = (value: string): string =>
  Array.from(value).filter((char) => char.charCodeAt(0) > 0x20 && char.charCodeAt(0) !== 0x7f).join("").toLowerCase();

const attr = (element: ElementInfo, name: string): DeckAttribute | undefined => element.attributes.find((attribute) => attribute.name === name);

/** Walks the tokens with the parser's open-element stack, recording each element's parent, style texts and math text. */
function walkTokens(tokens: DeckToken[]): Walk {
  const elements: ElementInfo[] = [];
  const styles: Walk["styles"] = [];
  const stack: ElementInfo[] = [];
  for (const token of tokens) {
    const top = stack[stack.length - 1];
    if (token.kind === "start") {
      const parent = top ?? null;
      const info: ElementInfo = { name: token.name, attributes: token.attributes, tag: token.range, parent, inHead: parent !== null && (parent.inHead || parent.name === "head") };
      if (token.attributes.some((attribute) => attribute.name === "data-math")) info.math = "";
      elements.push(info);
      if (!token.selfClosing && !VOID_ELEMENTS.has(token.name)) stack.push(info);
    } else if (token.kind === "end") {
      let match = stack.length - 1;
      while (match >= 0 && stack[match]!.name !== token.name) match--;
      if (match >= 0) stack.length = match;
    } else if (token.kind === "text") {
      if (token.raw && top?.name === "style") styles.push({ css: token.text, from: token.range.from });
      for (const open of stack) if (open.math !== undefined) open.math += token.text;
    }
  }
  return { elements, styles };
}

/** Whether { and } not preceded by a backslash balance, a } before its { counting as unbalanced. */
function bracesBalance(tex: string): boolean {
  let depth = 0;
  for (let index = 0; index < tex.length; index++) {
    if (index > 0 && tex[index - 1] === "\\") continue;
    if (tex[index] === "{") depth++;
    else if (tex[index] === "}" && --depth < 0) return false;
  }
  return depth === 0;
}

/** Checks one asset reference: DECK015 when unsafe, DECK016 when files is given and its path is missing. */
function checkReference(url: string, offset: number, theme: boolean, files: ReadonlySet<string> | undefined, out: Finding[]): void {
  const reference = classifyReference(url);
  if (reference.kind === "unsafe") out.push({ code: "DECK015", offset, theme, message: `The reference "${url}" ${reference.reason}.` });
  else if (reference.kind === "path" && files && !files.has(reference.path)) out.push({ code: "DECK016", offset, theme, message: `The reference "${url}" names ${reference.path}, which is not in the deck.` });
}

/** DECK015, DECK016 and DECK022 on one CSS text whose offset 0 sits at `from`. */
function checkCss(css: string, from: number, theme: boolean, files: ReadonlySet<string> | undefined, out: Finding[]): void {
  for (const url of findCssUrls(css)) checkReference(url.text, from + url.offset, theme, files, out);
  for (const heavy of findHeavyCss(css)) out.push({ code: "DECK022", offset: from + heavy.offset, theme, message: `Heavy CSS: a ${heavy.text}.` });
}

/** The rules that run on every input: DECK013 to DECK016, DECK019 and DECK022. */
function checkTokens(html: string, walk: Walk, files: ReadonlySet<string> | undefined, out: Finding[]): void {
  for (const element of walk.elements) {
    const at = element.tag.from;
    if (element.name === "script") out.push({ code: "DECK013", offset: at, theme: false, message: "A script element." });
    if (EMBEDDING.has(element.name)) out.push({ code: "DECK014", offset: at, theme: false, message: `A ${element.name} element.` });
    if (element.name === "meta" && attr(element, "http-equiv")?.value?.trim().toLowerCase() === "refresh") out.push({ code: "DECK014", offset: at, theme: false, message: "A meta http-equiv refresh." });
    if (element.math !== undefined && !bracesBalance(element.math)) out.push({ code: "DECK019", offset: at, theme: false, message: `The math "${element.math.trim()}" has unbalanced braces.` });
    for (const attribute of element.attributes) {
      const { name, value } = attribute;
      const nameAt = attribute.range.from;
      if (name.startsWith("on")) out.push({ code: "DECK013", offset: nameAt, theme: false, message: `An event handler attribute ${name}.` });
      if (value === null) continue;
      if (stripUrlNoise(value).startsWith("javascript:")) out.push({ code: "DECK013", offset: nameAt, theme: false, message: `A javascript: URL in ${name}.` });
      const svgAsset = element.name === "image" || element.name === "use";
      if (name === "src" || name === "poster" || (name === "href" && (element.name === "link" || svgAsset)) || (name === "xlink:href" && svgAsset)) checkReference(value, nameAt, false, files, out);
      else if (name === "srcset") for (const candidate of readSrcset(value)) checkReference(candidate.text, nameAt, false, files, out);
      else if (name === "style" && attribute.valueRange) checkCss(html.slice(attribute.valueRange.from, attribute.valueRange.to), attribute.valueRange.from, false, files, out);
    }
  }
  for (const style of walk.styles) checkCss(style.css, style.from, false, files, out);
}

/** DECK001 to DECK004: the root attributes. */
function checkRoot(model: DeckModel, root: ElementInfo, out: Finding[]): void {
  const push = (code: string, offset: number, message: string) => out.push({ code, offset, message, theme: false });
  const deck = attr(root, "data-deck");
  if (!model.kind) push("DECK001", deck?.range.from ?? root.tag.from, deck?.value != null ? `data-deck is "${deck.value}", not talk or poster.` : "data-deck is missing.");
  const version = attr(root, "data-deck-version");
  if (model.version !== "1") push("DECK002", version?.range.from ?? root.tag.from, model.version !== null ? `data-deck-version is "${model.version}", not 1.` : "data-deck-version is missing.");
  const size = attr(root, "data-deck-size");
  if (!size || size.value === null || !model.sizeRange) push("DECK003", size?.range.from ?? root.tag.from, "data-deck-size is missing.");
  else if (!model.size) push("DECK003", model.sizeRange.from, `data-deck-size "${size.value}" is malformed.`);
  else if (model.kind && (model.kind === "talk") !== (model.size.unit === "px")) push("DECK004", model.sizeRange.from, `The ${model.kind} size "${size.value}" uses ${model.size.unit}.`);
  else if (model.kind && !isDeckSizeAllowed(model.kind, model.size)) push("DECK003", model.sizeRange.from, `data-deck-size "${size.value}" is outside the range for a ${model.kind}.`);
}

/** DECK005 to DECK012, DECK017, DECK018, DECK020 and DECK021: the rules on the model's structure. */
function checkModel(html: string, model: DeckModel, walk: Walk, out: Finding[]): void {
  const push = (code: string, offset: number, message: string) => out.push({ code, offset, message, theme: false });
  const root = walk.elements.find((element) => element.name === "html")!;
  const body = walk.elements.find((element) => element.name === "body" && element.tag.to === model.bodyContentRange.from);
  checkRoot(model, root, out);
  if (model.slides.length === 0) push("DECK005", body?.tag.from ?? 0, "The body holds no <section data-slide>.");
  if (model.kind === "poster") for (const slide of model.slides.slice(1)) push("DECK006", slide.range.from, `The poster has a slide ${slide.index + 1}; a poster has one slide.`);
  const slideStarts = new Set(model.slides.map((slide) => slide.range.from));
  const blocks = new Map(model.slides.flatMap((slide) => slide.blocks.map((block) => [block.startTag.from, block] as const)));
  const themeLinks = walk.elements.filter((element) => element.name === "link" && attr(element, "data-deck-theme"));
  if (themeLinks.length === 0) push("DECK008", root.tag.from, "There is no <link data-deck-theme>.");
  themeLinks.forEach((link, index) => {
    const reasons: string[] = [];
    if (index > 0) reasons.push("repeats the theme link");
    if (!link.inHead) reasons.push("is not in head");
    if (!(attr(link, "rel")?.value ?? "").toLowerCase().split(/\s+/).includes("stylesheet")) reasons.push('lacks rel="stylesheet"');
    if (attr(link, "href")?.value !== "theme.css") reasons.push('lacks href="theme.css"');
    if (reasons.length > 0) push("DECK008", link.tag.from, `The theme link ${reasons.join(" and ")}.`);
  });
  const notesPerSlide = new Map<number, number>();
  for (const element of walk.elements) {
    const at = element.tag.from;
    if (attr(element, "data-slide") && !slideStarts.has(at)) push("DECK007", at, `A <${element.name} data-slide> that is not a section directly in body.`);
    const blockAttribute = attr(element, "data-block");
    if (blockAttribute && !blocks.has(at)) push("DECK009", at, `The block "${blockAttribute.value ?? ""}" is not directly in a slide.`);
    if (element.name === "aside" && attr(element, "data-notes")) {
      const parent = element.parent;
      if (!parent || !slideStarts.has(parent.tag.from)) push("DECK017", at, "A notes element that is not directly in a slide.");
      else {
        const count = (notesPerSlide.get(parent.tag.from) ?? 0) + 1;
        notesPerSlide.set(parent.tag.from, count);
        if (count > 1) push("DECK017", at, `Notes element ${count} in one slide.`);
      }
      if (model.kind === "poster") push("DECK018", at, "A notes element in a poster.");
    }
    const source = attr(element, "data-source");
    if (source) checkSource(element, source, blocks.has(at), push);
  }
  checkBlocks(html, model, blocks, out);
}

/** DECK010 to DECK012 and DECK025: block ids, rects and chart data. */
function checkBlocks(html: string, model: DeckModel, blocks: Map<number, DeckBlock>, out: Finding[]): void {
  const push = (code: string, offset: number, message: string) => out.push({ code, offset, message, theme: false });
  const ids = new Set<string>();
  const canvas = model.kind && model.size && (model.kind === "talk") === (model.size.unit === "px") && isDeckSizeAllowed(model.kind, model.size) ? deckCanvasPx(model.size) : null;
  for (const block of blocks.values()) {
    const at = block.startTag.from;
    if (!BLOCK_ID.test(block.id)) push("DECK010", at, `The block id "${block.id}" is not lowercase letters, digits and hyphens starting with a letter, at most 40 long.`);
    else if (ids.has(block.id)) push("DECK010", at, `The block id "${block.id}" repeats an earlier block.`);
    ids.add(block.id);
    const chart = readDeckChart(html, block);
    if (chart && !isDeckChartModel(chart.model)) push("DECK025", at, "Chart data cannot be read; the chart shows its image but cannot be edited");
    if (!block.rect) push("DECK011", at, `The block "${block.id}" ${describeRectProblem(html, block.rectRanges)}.`);
    else if (canvas) {
      const { left, top, width, height } = block.rect;
      const round = (value: number) => Math.round(value * 100) / 100;
      if (left < 0 || top < 0 || round(left + width) > canvas.width || round(top + height) > canvas.height) push("DECK012", at, `The block "${block.id}" leaves the ${canvas.width} x ${canvas.height} px canvas.`);
    }
  }
}

/** Names the first missing, malformed or negative rect property. */
function describeRectProblem(html: string, ranges: Partial<Record<"left" | "top" | "width" | "height", DeckRange>>): string {
  for (const property of ["left", "top", "width", "height"] as const) {
    const range = ranges[property];
    if (!range) return `has no ${property} in its style`;
    const value = html.slice(range.from, range.to);
    if (!RECT_VALUE.test(value)) return `has ${property} "${value}", not a px value with at most 2 decimals`;
    if ((property === "width" || property === "height") && parseFloat(value) < 0) return `has a negative ${property}`;
  }
  return "has an invalid rect";
}

/** DECK020 and DECK021 on one data-source attribute. */
function checkSource(element: ElementInfo, source: DeckAttribute, isBlock: boolean, push: (code: string, offset: number, message: string) => void): void {
  const at = source.range.from;
  const value = source.value ?? "";
  if (!isBlock) return push("DECK020", at, `data-source "${value}" is on a <${element.name}> that is not a block.`);
  const match = SOURCE_VALUE.exec(value);
  if (!match) push("DECK020", at, `data-source "${value}" is not figure:, eq:, table: or cite: with a reference without whitespace.`);
  else if (match[1] === "figure" && (/^([/\\]|[A-Za-z][A-Za-z0-9+.-]*:)/.test(match[2]!) || escapesFolder(match[2]!))) push("DECK020", at, `The figure path "${match[2]}" is absolute or leaves the project.`);
  const hash = attr(element, "data-source-hash");
  if (!hash) push("DECK021", at, `The block with data-source "${value}" has no data-source-hash.`);
  else if (!SOURCE_HASH.test(hash.value ?? "")) push("DECK020", hash.range.from, `data-source-hash "${hash.value ?? ""}" is not 12 lowercase hex.`);
}

/** The slide index and block id holding an offset of the deck. */
function locate(model: DeckModel | undefined, offset: number): { slide?: number; block?: string } {
  const within = (range: DeckRange) => offset >= range.from && offset < range.to;
  const slide = model?.slides.find((candidate) => within(candidate.range));
  if (!slide) return {};
  const block = slide.blocks.find((candidate) => within(candidate.range));
  return block ? { slide: slide.index, block: block.id } : { slide: slide.index };
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Validates deck HTML, and the theme and file list when given; never throws. */
export function validateDeck(html: string, options: DeckValidateOptions = {}): DeckDiagnostic[] {
  const { files, theme } = options;
  const findings: Finding[] = [];
  const { tokens } = tokenizeDeckHtml(html);
  // The theme's layout grid gives a cell block its rect, checked against the canvas like a px rect.
  const { model, problems } = parseDeck(html, theme === undefined ? {} : { theme });
  const walk = walkTokens(tokens);
  for (const problem of problems) findings.push({ code: "DECK023", offset: problem.offset, theme: false, message: `Malformed markup: ${problem.message}.` });
  checkTokens(html, walk, files, findings);
  if (model) checkModel(html, model, walk, findings);
  else {
    const root = walk.elements.find((element) => element.name === "html");
    findings.push({ code: "DECK001", offset: root?.tag.from ?? 0, theme: false, message: root ? "The html element has no body." : "There is no html element." });
  }
  if (theme !== undefined) {
    checkCss(theme, 0, true, files, findings);
    if (readThemeProperties(theme).length === 0) findings.push({ code: "DECK024", offset: 0, theme: true, message: "The theme's first :root rule declares no custom property." });
  }
  const diagnostics = findings.map((finding): DeckDiagnostic => {
    const [severity, , hint] = RULE_BY_CODE.get(finding.code)!;
    const position = deckLineColumn(finding.theme ? theme ?? "" : html, finding.offset);
    const place = finding.theme ? { file: "theme.css" as const } : locate(model, finding.offset);
    return { code: finding.code, severity, ...place, line: position.line, column: position.column, message: finding.message, hint };
  });
  return diagnostics.sort((a, b) => (a.file ? 1 : 0) - (b.file ? 1 : 0) || a.line - b.line || a.column - b.column || compareText(a.code, b.code) || compareText(a.message, b.message));
}
