// Shared helpers and samples for the deckValidate tests (spec 1.3); split out so each test file stays under 500 lines.
import { listDeckRules, type DeckDiagnostic, type DeckSeverity, type DeckValidateOptions } from "../../src/decks/deckValidate.js";

export const SEVERITY: Record<string, DeckSeverity> = {
  DECK001: "error", DECK002: "error", DECK003: "error", DECK004: "error", DECK005: "error", DECK006: "error",
  DECK007: "error", DECK008: "error", DECK009: "error", DECK010: "error", DECK011: "error", DECK012: "warning",
  DECK013: "error", DECK014: "error", DECK015: "error", DECK016: "warning", DECK017: "error", DECK018: "warning",
  DECK019: "error", DECK020: "error", DECK021: "warning", DECK022: "warning", DECK023: "error", DECK024: "warning",
};

export const THEME = ":root { --deck-bg: #ffffff; --deck-fg: #1a1a1a; }\n";
export const TALK_FILES: ReadonlySet<string> = new Set(["theme.css", "assets/plot.png"]);
export const TALK_OPTIONS: DeckValidateOptions = { theme: THEME, files: TALK_FILES };

export const HEAD = [
  "<head>",
  '<meta charset="utf-8">',
  "<title>Sample</title>",
  '<link rel="stylesheet" href="theme.css" data-deck-theme>',
  "</head>",
].join("\n");

export const TALK_ROOT = 'data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px"';
export const POSTER_ROOT = 'data-deck="poster" data-deck-version="1" data-deck-size="841x1189mm"';

export const SAMPLE_TALK = [
  "<!doctype html>",
  '<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">',
  HEAD,
  "<body>",
  "<section data-slide>",
  '<div data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1>Title</h1></div>',
  "<aside data-notes>Say hello.</aside>",
  "</section>",
  "<section data-slide>",
  '<div data-block="body" style="left: 120px; top: 320px; width: 1680px; height: 600px;"><p>Some text.</p><div data-math="display">\\frac{a}{b}</div><img src="assets/plot.png" alt="Plot"></div>',
  "</section>",
  "</body>",
  "</html>",
  "",
].join("\n");

export const SAMPLE_POSTER = [
  "<!doctype html>",
  `<html lang="en" ${POSTER_ROOT}>`,
  HEAD,
  "<body>",
  "<section data-slide>",
  '<div data-block="title" style="left: 100px; top: 100px; width: 2978px; height: 400px;"><h1>Poster title</h1></div>',
  '<div data-block="col-left" style="left: 100px; top: 600px; width: 1400px; height: 3700px;"><p>Left column.</p></div>',
  '<div data-block="col-right" data-source="figure:figures/plot.pdf" data-source-hash="3f2a9c1b7e04" style="left: 1678.5px; top: 600px; width: 1400px; height: 3700px;"><p>Right column.</p></div>',
  "</section>",
  "</body>",
  "</html>",
  "",
].join("\n");

/** A full document with the given root attributes, head and body content. */
export function doc(root: string, body: string, head: string = HEAD): string {
  return `<!doctype html>\n<html lang="en" ${root}>\n${head}\n<body>\n${body}\n</body>\n</html>\n`;
}

export const slide = (inner: string): string => `<section data-slide>\n${inner}\n</section>`;

export const STYLE = "left: 120px; top: 80px; width: 400px; height: 200px;";
export const block = (id: string, inner = "<p>Text</p>", style = STYLE, extra = ""): string =>
  `<div data-block="${id}"${extra} style="${style}">${inner}</div>`;

/** A one-slide talk holding `inner` in its slide. */
export const talk = (inner: string, head: string = HEAD): string => doc(TALK_ROOT, slide(inner), head);
/** A one-slide poster holding `inner` in its slide. */
export const poster = (inner: string): string => doc(POSTER_ROOT, slide(inner));

/** 1-based line and column of the nth occurrence of needle in text. */
export function at(text: string, needle: string, nth = 0): { line: number; column: number } {
  let index = -1;
  for (let i = 0; i <= nth; i += 1) {
    index = text.indexOf(needle, index + 1);
    if (index < 0) throw new Error(`needle ${needle} not found`);
  }
  const before = text.slice(0, index);
  return { line: before.split("\n").length, column: index - before.lastIndexOf("\n") };
}

export const withCode = (diagnostics: DeckDiagnostic[], code: string): DeckDiagnostic[] => diagnostics.filter((d) => d.code === code);

/** Asserts that code occurs, with its table severity, the rule's hint, a message and a 1-based location. Returns those diagnostics. */
export function expectCode(diagnostics: DeckDiagnostic[], code: string): [DeckDiagnostic, ...DeckDiagnostic[]] {
  const found = withCode(diagnostics, code);
  expect(found.length).toBeGreaterThan(0);
  const rule = listDeckRules().find((r) => r.code === code);
  for (const d of found) {
    expect(d.severity).toBe(SEVERITY[code]);
    expect(d.hint).toBe(rule?.hint);
    expect(typeof d.message).toBe("string");
    expect(d.message.length).toBeGreaterThan(0);
    expect(d.line).toBeGreaterThanOrEqual(1);
    expect(d.column).toBeGreaterThanOrEqual(1);
  }
  return found as [DeckDiagnostic, ...DeckDiagnostic[]];
}

export const compareDiagnostics = (a: DeckDiagnostic, b: DeckDiagnostic): number =>
  (a.file ? 1 : 0) - (b.file ? 1 : 0) || a.line - b.line || a.column - b.column || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
