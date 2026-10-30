/**
 * Tests that the committed tokens.css matches the token data and that the reader paints highlights from it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ANNOTATION_COLORS, HIGHLIGHT_COLORS, renderTokensCss } from "@labshelf/core";

const SRC = join(__dirname, "../../src");
const TOKENS_CSS = join(SRC, "ui/dom/tokens.css");

describe("tokens.css", () => {
  // `pnpm --filter @labshelf/core tokens` regenerates the file through this test.
  it("is the rendering of the token data", () => {
    if (process.env["WRITE_TOKENS"]) writeFileSync(TOKENS_CSS, renderTokensCss());
    expect(readFileSync(TOKENS_CSS, "utf8")).toBe(renderTokensCss());
  });

  it("points each picked code font at its family, falling back to the monospace stack", () => {
    expect(renderTokensCss()).toContain(':root[data-code-font="opendyslexic"] { --ls-code-font: "OpenDyslexic", var(--ls-mono); }');
  });

  it("lists the serif title face", () => {
    expect(renderTokensCss()).toContain('--ls-serif: "Source Serif 4", Georgia, serif;');
  });

  it("keeps the dark and light selectors the browser rewrites", () => {
    const css = renderTokensCss();
    expect(css).toContain(":root {");
    expect(css).toContain(':root[data-theme="light"] {');
  });

  it("renders a light value only for tokens that have one", () => {
    const css = renderTokensCss({ a: { value: "1", light: "2" }, b: { value: "3" } });
    const [dark, light] = css.split(':root[data-theme="light"]');
    expect(dark).toContain("--ls-a: 1;");
    expect(dark).toContain("--ls-b: 3;");
    expect(light).toContain("--ls-a: 2;");
    expect(light).not.toContain("--ls-b");
  });
});

describe("renderHighlightedHtml palette (B6)", () => {
  it("covers every annotation colour plus the uncoloured note", () => {
    expect(Object.keys(HIGHLIGHT_COLORS).sort()).toEqual([...ANNOTATION_COLORS, "note"].sort());
  });

  it("is what the reader paints its colour swatches with", () => {
    const readerCss = readFileSync(join(SRC, "reader/dom/styles/reader.css"), "utf8");
    for (const name of Object.keys(HIGHLIGHT_COLORS)) {
      expect(readerCss).toMatch(new RegExp(`\\.rd-color-${name} \\{[^}]*background: var\\(--ls-hl-${name}\\); \\}`));
      expect(renderTokensCss()).toContain(`--ls-hl-${name}: ${HIGHLIGHT_COLORS[name as keyof typeof HIGHLIGHT_COLORS]};`);
    }
  });
});
