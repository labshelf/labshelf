// Tests that the completion catalog has unique names and snippets in valid VS Code snippet syntax.
import { LATEX_COMMANDS, LATEX_ENVIRONMENTS, type LatexCatalogEntry } from "../../../src/latex/catalog";

// Placeholders hold no braces, so removing every well-formed tab stop must leave no `$`.
function tabStopsAreWellFormed(snippet: string): boolean {
  const withoutStops = snippet.replace(/\$\{\d+:[^{}]*\}|\$\{\d+\}|\$\d+/g, "");
  const stops = [...snippet.matchAll(/\$\{?(\d+)/g)].map((match) => match[1]);
  return !withoutStops.includes("$") && stops.filter((stop) => stop === "0").length <= 1;
}

function duplicates(entries: readonly LatexCatalogEntry[]): string[] {
  const names = entries.map((entry) => entry.name);
  return names.filter((name, index) => names.indexOf(name) !== index);
}

describe("LaTeX catalog", () => {
  it("holds about two hundred commands and environments", () => {
    const total = LATEX_COMMANDS.length + LATEX_ENVIRONMENTS.length;
    expect(total).toBeGreaterThanOrEqual(180);
    expect(total).toBeLessThanOrEqual(260);
  });

  it("has no duplicate names within commands or within environments", () => {
    expect(duplicates(LATEX_COMMANDS)).toEqual([]);
    expect(duplicates(LATEX_ENVIRONMENTS)).toEqual([]);
  });

  it("describes every entry", () => {
    for (const entry of [...LATEX_COMMANDS, ...LATEX_ENVIRONMENTS]) {
      expect(entry.name).toMatch(/^[A-Za-z]+\*?$/);
      expect(entry.detail.trim()).not.toBe("");
    }
  });

  it("writes command snippets that start at the command name, without the backslash", () => {
    for (const entry of LATEX_COMMANDS) {
      expect(entry.snippet.startsWith(entry.name)).toBe(true);
      expect(tabStopsAreWellFormed(entry.snippet)).toBe(true);
    }
  });

  it("writes environment snippets with well-formed tab stops", () => {
    for (const entry of LATEX_ENVIRONMENTS) { expect(tabStopsAreWellFormed(entry.snippet)).toBe(true); }
  });

  it("covers the base, amsmath, graphicx and hyperref essentials", () => {
    const commands = new Set(LATEX_COMMANDS.map((entry) => entry.name));
    for (const name of ["section", "textbf", "frac", "eqref", "includegraphics", "href", "toprule", "begin", "end"]) {
      expect(commands.has(name)).toBe(true);
    }
    const environments = new Set(LATEX_ENVIRONMENTS.map((entry) => entry.name));
    for (const name of ["document", "itemize", "equation", "align*", "figure", "tabular", "proof"]) {
      expect(environments.has(name)).toBe(true);
    }
  });
});
