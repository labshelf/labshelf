/**
 * Asserts WCAG 2.x contrast of at least 4.5:1 for text/background design-token pairs in every theme.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CODE_THEME_NAMES } from "@labshelf/core";

const TOKENS_CSS = join(__dirname, "../../../src/ui/dom/tokens.css");
const MIN_RATIO = 4.5;

type TokenMap = Map<string, string>;

function blockDeclarations(css: string, selector: string): TokenMap {
  const map: TokenMap = new Map();
  let found = false;
  for (let at = css.indexOf(`${selector} {`); at >= 0; at = css.indexOf(`${selector} {`, at + 1)) {
    found = true;
    const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
    for (const m of body.matchAll(/(--ls-[\w-]+)\s*:\s*([^;]+);/g)) map.set(m[1]!, m[2]!.trim());
  }
  if (!found) throw new Error(`tokens.css has no ${selector} block`);
  return map;
}

function loadTheme(selectors: string[]): TokenMap {
  const css = readFileSync(TOKENS_CSS, "utf8");
  const merged: TokenMap = new Map();
  for (const selector of selectors) for (const [k, v] of blockDeclarations(css, selector)) merged.set(k, v);
  return merged;
}

function resolve(tokens: TokenMap, name: string): [number, number, number] {
  let value = tokens.get(name);
  for (let hops = 0; value !== undefined && value.startsWith("var("); hops++) {
    if (hops > 10) throw new Error(`token ${name} has a var() cycle`);
    value = tokens.get(/var\((--ls-[\w-]+)\)/.exec(value)![1]!);
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(value ?? "");
  if (!hex) throw new Error(`token ${name} is not an opaque #rrggbb colour (got ${value})`);
  const n = parseInt(hex[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(tokens: TokenMap, fg: string, bg: string): number {
  const [a, b] = [luminance(resolve(tokens, fg)), luminance(resolve(tokens, bg))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Role -> [foreground token, background token]. Only text pairs; borders and focus rings are 3:1 cases. */
const PAIRS: Record<string, [string, string]> = {
  "body text on editor background": ["--ls-fg", "--ls-bg"],
  "muted text on editor background": ["--ls-desc", "--ls-bg"],
  "body text on sidebar": ["--ls-fg", "--ls-sidebar-bg"],
  "muted text on sidebar": ["--ls-desc", "--ls-sidebar-bg"],
  "section header text on section background": ["--ls-section-fg", "--ls-section-bg"],
  "error text on editor background": ["--ls-error", "--ls-bg"],
  "link on editor background": ["--ls-link", "--ls-bg"],
  "link on sidebar": ["--ls-link", "--ls-sidebar-bg"],
  "body text on widget background": ["--ls-fg", "--ls-widget-bg"],
  "body text on code background": ["--ls-fg", "--ls-code-bg"],
  "status bar text": ["--ls-statusbar-fg", "--ls-statusbar-bg"],
  "active list row text": ["--ls-list-active-fg", "--ls-list-active-bg"],
  "body text on hovered list row": ["--ls-fg", "--ls-list-hover"],
  "body text on inactive selected list row": ["--ls-fg", "--ls-list-inactive-bg"],
  "menu text": ["--ls-menu-fg", "--ls-menu-bg"],
  "selected menu item text": ["--ls-menu-selection-fg", "--ls-menu-selection-bg"],
  "primary button text": ["--ls-button-fg", "--ls-button-bg"],
  "primary button text on hover": ["--ls-button-fg", "--ls-button-hover"],
  "secondary button text": ["--ls-button2-fg", "--ls-button2-bg"],
  "secondary button text on hover": ["--ls-button2-fg", "--ls-button2-hover"],
  "input text": ["--ls-input-fg", "--ls-input-bg"],
  "input placeholder": ["--ls-input-placeholder", "--ls-input-bg"],
  "badge text": ["--ls-badge-fg", "--ls-badge-bg"],
  "banner text on warning background": ["--ls-fg", "--ls-warning-bg"],
  "soft button text on editor background": ["--ls-button-soft-fg", "--ls-bg"],
  "PDF file type on editor background": ["--ls-file-pdf", "--ls-bg"],
  "Markdown file type on editor background": ["--ls-file-md", "--ls-bg"],
  "reference file type on editor background": ["--ls-file-ref", "--ls-bg"],
  "folder file type on editor background": ["--ls-file-dir", "--ls-bg"],
};

const READER_PAIRS: Record<string, [string, string]> = {
  "reader text on page": ["--ls-reader-fg", "--ls-reader-page"],
  "reader text on toolbar surface": ["--ls-reader-fg", "--ls-reader-surface"],
  "reader muted text on toolbar surface": ["--ls-reader-desc", "--ls-reader-surface"],
  "reader text on reader background": ["--ls-reader-fg", "--ls-reader-bg"],
};

const THEMES: Record<string, string[]> = {
  dark: [":root"],
  light: [":root", ':root[data-theme="light"]'],
};

const READER_THEMES: Record<string, string[]> = {
  "reader dark": [":root"],
  "reader light": [":root", '[data-pdf-theme="light"]'],
  "reader sepia": [":root", '[data-pdf-theme="sepia"]'],
  "reader high-contrast": [":root", '[data-pdf-theme="high-contrast"]'],
};

const CODE_ROLES = ["keyword", "command", "argument", "string", "number", "math", "comment", "heading", "reference", "bracket"];
const CODE_PAIRS: Record<string, [string, string]> = Object.fromEntries(
  CODE_ROLES.map((role) => [`code ${role} on editor background`, [`--ls-code-${role}`, "--ls-bg"]]),
);

const CODE_THEMES: Record<string, string[]> = Object.fromEntries(CODE_THEME_NAMES.flatMap((name) => {
  const pick = name === "labshelf" ? [] : [`:root[data-code-theme="${name}"]`];
  const pickLight = name === "labshelf" ? [] : [`:root[data-theme="light"][data-code-theme="${name}"]`];
  return [[`code ${name} dark`, [":root", ...pick]], [`code ${name} light`, [":root", ':root[data-theme="light"]', ...pickLight]]];
}));

function describePairs(themes: Record<string, string[]>, pairs: Record<string, [string, string]>): void {
  for (const [theme, selectors] of Object.entries(themes)) {
    describe(`${theme} theme`, () => {
      const tokens = loadTheme(selectors);
      it.each(Object.entries(pairs))(`%s meets ${MIN_RATIO}:1`, (role, [fg, bg]) => {
        const ratio = contrast(tokens, fg, bg);
        if (ratio < MIN_RATIO) {
          throw new Error(`${theme}: ${role} (${fg} on ${bg}) has contrast ${ratio.toFixed(2)}:1, below ${MIN_RATIO}:1`);
        }
      });
    });
  }
}

describe("design token text contrast", () => {
  describePairs(THEMES, PAIRS);
  describePairs(READER_THEMES, READER_PAIRS);
  describePairs(CODE_THEMES, CODE_PAIRS);

  it("computes the WCAG reference ratios", () => {
    const tokens: TokenMap = new Map([["--a", "#000000"], ["--b", "#ffffff"]]);
    expect(contrast(tokens, "--a", "--b")).toBeCloseTo(21, 5);
    expect(contrast(tokens, "--a", "--a")).toBeCloseTo(1, 5);
  });
});
