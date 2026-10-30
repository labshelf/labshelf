/**
 * Tests that the reader's page themes, its pdf.js page colours and reader.css all read the one reader theme table.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READER_THEMES, THEME_PRESETS, deriveReaderTheme, readerThemeCssVars, renderTokensCss, renderVscodeHostCss } from "@labshelf/core";

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
    // Two reader-local properties are deliberate: the PDF link ink pair (a tone blended over the page canvas, one per
    // page tone) and the annotation colour a swatch hands to the underline highlight. Everything else stays on --ls-*.
    const localLinkInk = /^#viewerContainer(\[data-pdf-link-tone="dark"\])? \{ --rd-link-ink: [^;]+; --rd-link-ink-hover: [^;]+; --rd-link-blend: \w+; \}$/gm;
    const own = READER_CSS.replace(localLinkInk, "");
    expect(own).not.toMatch(/--vscode-|--pdf-/);
    expect(own.replace(/--rd-(link-ink|link-ink-hover|link-blend|annotation-color)\b/g, "")).not.toMatch(/--rd-/);
    expect(own).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it("invert plot ink on dark themes and leave it on light ones", () => {
    const invert = "invert(1) hue-rotate(180deg)";
    const css = renderTokensCss();
    expect(css).toMatch(new RegExp(`:root \\{[^}]*--ls-plot-filter: invert\\(1\\) hue-rotate\\(180deg\\);`));
    expect(css).toMatch(/:root\[data-theme="light"\] \{[^}]*--ls-plot-filter: none;/);
    expect(READER_THEMES.dark.plotFilter).toBe(invert);
    expect(READER_THEMES["high-contrast"].plotFilter).toBe(invert);
    expect(READER_THEMES.light.plotFilter).toBe("none");
    expect(READER_THEMES.sepia.plotFilter).toBe("none");
    expect(css).toMatch(/\[data-pdf-theme="sepia"\] \{[^}]*--ls-reader-plot-filter: none;/);
    expect(readerThemeCssVars(deriveReaderTheme("#fdfdf0", "#202020"))["--ls-reader-plot-filter"]).toBe("none");
    expect(readerThemeCssVars(deriveReaderTheme("#101820", "#e0e0e0"))["--ls-reader-plot-filter"]).toBe(invert);
    expect(renderVscodeHostCss()).toMatch(/body\.vscode-light, body\.vscode-high-contrast-light \{[^}]*--ls-plot-filter: none;/);
  });
});
