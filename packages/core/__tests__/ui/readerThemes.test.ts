/**
 * Tests that the reader's page themes, its pdf.js page colours and reader.css all read the one reader theme table.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READER_THEMES, THEME_PRESETS, renderTokensCss } from "@labshelf/core";

const READER_CSS = readFileSync(join(__dirname, "../../src/reader/dom/styles/reader.css"), "utf8");

describe("reader themes", () => {
  it("hand pdf.js the page colours of the theme table", () => {
    for (const [name, theme] of Object.entries(READER_THEMES)) {
      expect(THEME_PRESETS[name as keyof typeof THEME_PRESETS]).toEqual({ bg: theme.page, text: theme.ink });
    }
  });

  it("render one tokens block per non-default theme, keyed on data-pdf-theme", () => {
    const css = renderTokensCss();
    for (const name of ["light", "sepia", "high-contrast"]) {
      expect(css).toContain(`[data-pdf-theme="${name}"] {\n  --ls-reader-page: ${READER_THEMES[name as keyof typeof READER_THEMES].page};`);
    }
    expect(css).toContain(`--ls-reader-page: ${READER_THEMES.dark.page};`);
  });

  it("leave reader.css on the --ls-* tokens with no colour of its own", () => {
    expect(READER_CSS).not.toMatch(/--vscode-|--rd-|--pdf-/);
    expect(READER_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
