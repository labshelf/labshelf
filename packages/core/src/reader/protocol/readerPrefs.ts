// Holds the reader's preferences and presentation rules: validated prefs, theme colours, DOM skeleton, citation and Markdown formats, toolbar auto-hide.
import { DEFAULT_READER_PREFS, type CitationStyle, type ReaderPrefs, type ZoomKind, type EffectiveTheme } from "./index.js";
import { READER_THEMES } from "../../ui/index.js";
import { formatInTextCitation } from "../../library/index.js";
import type { PaperRecord, Annotation } from "../../model/index.js";
import { compareAnnotations } from "../sidecar/index.js";

// Validates reader preferences coming from user-editable storage (VS Code settings, browser storage) into the ReaderPrefs shape.

const ZOOM_PRESETS: readonly ZoomKind[] = ["page-width", "page-fit", "page-actual", "auto"];
const CITATION_STYLES: readonly CitationStyle[] = ["pandoc", "latex", "author-year", "citekey"];
const MAX_HOVER_DELAY_MS = 2000;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Every value is validated on its own and falls back to its default, so one bad entry never discards the rest.
 * @returns complete, valid reader preferences.
 */
export function normalizeReaderPrefs(raw: Readonly<Record<string, unknown>> | null | undefined): ReaderPrefs {
  const src = raw ?? {};
  const d = DEFAULT_READER_PREFS;
  const bool = (key: keyof ReaderPrefs, fallback: boolean): boolean => {
    const v = src[key];
    return typeof v === "boolean" ? v : fallback;
  };
  const delay = src["hoverDelayMs"];
  return {
    vimKeys: bool("vimKeys", d.vimKeys),
    defaultZoom: oneOf(src["defaultZoom"], ZOOM_PRESETS, d.defaultZoom),
    toolbarAutoHide: bool("toolbarAutoHide", d.toolbarAutoHide),
    restorePosition: bool("restorePosition", d.restorePosition),
    hoverPreviews: bool("hoverPreviews", d.hoverPreviews),
    hoverDelayMs: typeof delay === "number" && Number.isFinite(delay)
      ? Math.min(MAX_HOVER_DELAY_MS, Math.max(0, delay))
      : d.hoverDelayMs,
    citationStyle: oneOf(src["citationStyle"], CITATION_STYLES, d.citationStyle),
  };
}

// Supplies the page-pixel colours each reader theme hands to pdf.js `pageColors`, read from the reader theme tokens.

interface PagePreset {
  bg: string;
  text: string;
}

export const THEME_PRESETS = Object.fromEntries(
  Object.entries(READER_THEMES).map(([name, theme]) => [name, { bg: theme.page, text: theme.ink }]),
) as Record<EffectiveTheme, PagePreset>;

/**
 * Looks up a preset, falling back to light for an unknown theme name.
 * @returns the page colours for the theme.
 */
export function findPagePreset(theme: string): PagePreset {
  return (THEME_PRESETS as Record<string, PagePreset>)[theme] ?? THEME_PRESETS.light;
}

/**
 * pdf.js treats `null` pageColors as "render the PDF's own colours"; black on white must map to that so the light theme never recolours figures.
 * @returns a pageColors object, or null for untouched rendering.
 */
export function derivePageColors(bg: string, text: string): { background: string; foreground: string } | null {
  const isIdentity = bg.toLowerCase() === "#ffffff" && text.toLowerCase() === "#000000";
  return isIdentity ? null : { background: bg, foreground: text };
}

// Declares the reader's DOM skeleton: every container the reader UI looks up by id.
// Both hosts emit exactly this markup inside <body>, so the UI sees the same document.

/** Markup of <body> before the boot block and scripts. */
export const READER_SHELL_BODY = `<div id="app">
  <aside id="sidebar" aria-label="Sidebar" hidden></aside>
  <div id="sidebar-resizer" hidden></div>
  <main id="pdf-shell">
    <div id="toolbar" role="toolbar" aria-label="Reader"></div>
    <div id="find-bar" role="search"></div>
    <div id="viewerContainer" tabindex="0"><div id="viewer" class="pdfViewer"></div></div>
    <div id="status-pill"></div>
    <div id="build-banner" role="status" aria-live="polite" hidden></div>
    <div id="loading-msg">Loading PDF...</div>
    <div id="error-msg" role="alert" hidden></div>
  </main>
</div>
<div id="selection-toolbar" role="toolbar" aria-label="Selection"></div>
<div id="hover-popup" role="tooltip"></div>
<div id="cheatsheet"></div>`;

// Formats a quoted passage together with a citation of the paper it came from, in the style chosen by `labshelf.reader.citationStyle`.

export type CitablePaper = Pick<PaperRecord, "citeKey" | "title" | "authors" | "year">;

/**
 * Text-layer selections carry hard line breaks and hyphenation from the PDF layout; a quote should read as running prose.
 * @returns the quote with hyphenation joined and whitespace collapsed.
 */
export function normalizeQuote(text: string): string {
  return text
    .replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds the clipboard text for "copy with citation".
 * @returns the quote plus its citation in the requested style.
 */
export function formatQuoteWithCitation(
  text: string,
  paper: CitablePaper,
  pageNumber: number,
  style: CitationStyle,
): string {
  const quote = normalizeQuote(text);
  switch (style) {
    case "pandoc":
      return `> ${quote}\n\n[@${paper.citeKey}, p. ${pageNumber}]`;
    case "latex":
      return `\`\`${quote}'' \\cite[p.~${pageNumber}]{${paper.citeKey}}`;
    case "author-year":
      return `"${quote}" (${formatInTextCitation(paper)}, p. ${pageNumber})`;
    case "citekey":
      return `${quote} @${paper.citeKey}`;
  }
}

// Renders a paper's annotations as a Markdown reading-notes document grouped by page.

/**
 * Highlights become block quotes tagged with their colour; notes and comments become plain paragraphs.
 * @returns a Markdown document ending in a newline.
 */
export function formatAnnotationsMarkdown(paper: CitablePaper, annotations: readonly Annotation[]): string {
  const lines: string[] = [`# ${paper.title}`, "", `${formatInTextCitation(paper)} · \`@${paper.citeKey}\``, ""];
  if (annotations.length === 0) {
    lines.push("_No annotations._", "");
    return lines.join("\n");
  }
  const sorted = [...annotations].sort(compareAnnotations);
  let page = -1;
  for (const ann of sorted) {
    if (ann.pageNumber !== page) {
      page = ann.pageNumber;
      lines.push(`## Page ${page}`, "");
    }
    const body = normalizeQuote(ann.content);
    if (ann.type === "highlight") {
      lines.push(`> ${body}`, "", `<!-- highlight: ${ann.color ?? "yellow"} --> [@${paper.citeKey}, p. ${page}]`, "");
    } else {
      lines.push(`**${ann.type[0]!.toUpperCase()}${ann.type.slice(1)}:** ${body}`, "");
    }
  }
  return lines.join("\n");
}

// Decides when the overlay toolbar is visible. Kept as a pure reducer so the feel (thresholds, pinning conditions) is unit-tested rather than tuned by hand in DOM handlers.

const HIDE_AFTER_DOWN_PX = 24;
const SHOW_AFTER_UP_PX = 8;
const POINTER_REVEAL_PX = 48;
const TOP_REVEAL_PX = 8;

export interface AutohideState {
  visible: boolean;
  /** Cumulative scroll distance in the current direction; sign is the direction (+ down, - up). */
  travel: number;
}

export interface AutohideInputs {
  enabled: boolean;
  /**
   * False until the reader first scrolls by hand (wheel, key, touch, scrollbar). pdf.js scrolls programmatically
   * while opening and restoring a position; that must not hide the toolbar before the reader has even seen it.
   * Omitted means engaged.
   */
  engaged?: boolean;
  scrollTop: number;
  pointerY: number | null;
  focusWithin: boolean;
  findOpen: boolean;
  menuOpen: boolean;
}

export type AutohideEvent =
  | { kind: "scroll"; delta: number }
  | { kind: "inputs" };

export const initialAutohide: AutohideState = { visible: true, travel: 0 };

function pinned(i: AutohideInputs): boolean {
  return !i.enabled
    || i.engaged === false
    || i.focusWithin
    || i.findOpen
    || i.menuOpen
    || i.scrollTop < TOP_REVEAL_PX
    || (i.pointerY !== null && i.pointerY < POINTER_REVEAL_PX);
}

/**
 * @returns the next state; callers apply `visible` to the DOM only when it changes.
 */
export function deriveToolbarVisibility(
  state: AutohideState,
  event: AutohideEvent,
  inputs: AutohideInputs,
): AutohideState {
  if (pinned(inputs)) { return { visible: true, travel: 0 }; }
  if (event.kind === "inputs") {
    // A pin was just released (pointer left the top, menu closed): stay as-is until the reader scrolls.
    return state;
  }
  const sameDirection = Math.sign(event.delta) === Math.sign(state.travel);
  const travel = sameDirection ? state.travel + event.delta : event.delta;
  if (travel > HIDE_AFTER_DOWN_PX) { return { visible: false, travel }; }
  if (travel <= -SHOW_AFTER_UP_PX) { return { visible: true, travel }; }
  return { visible: state.visible, travel };
}
