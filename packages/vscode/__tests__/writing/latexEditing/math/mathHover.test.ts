// Tests that hovering math in a LaTeX file previews it as an image, with the macros of the whole project.
import * as vscode from "vscode";

import { mathHoverProvider } from "../../../../src/writing/latexEditing/math";
import { at, latexProject, resetOpenDocuments, restoreDiskReads } from "../../../support/latexProjectFixtures";
import { fakeDocument, withCursor } from "../../../support/textDocument";

const DISK = {
  "main.tex": "\\input{macros}\nWe have $\\R^n$.",
  "macros.tex": "\\newcommand{\\R}{\\mathbb{R}}",
};

afterEach(() => { resetOpenDocuments(); restoreDiskReads(); });

async function hover(marked: string, path = at("main.tex")) {
  const { sources } = latexProject(DISK);
  const { text, position } = withCursor(marked);
  return mathHoverProvider(sources).provideHover(fakeDocument(path, text), position, {} as vscode.CancellationToken);
}

function markdownOf(result: vscode.Hover | null | undefined): string {
  return (result!.contents as unknown as vscode.MarkdownString).value;
}

function svgOf(result: vscode.Hover | null | undefined): string {
  const base64 = /base64,([^)]+)\)/.exec(markdownOf(result))![1]!;
  return Buffer.from(base64, "base64").toString("utf8");
}

describe("mathHoverProvider", () => {
  it("renders inline math as an SVG image covering the whole span", async () => {
    const result = await hover("\\input{macros}\nWe have $\\alpha|^2$.");
    expect(markdownOf(result)).toMatch(/^!\[math\]\(data:image\/svg\+xml;base64,/);
    const range = result!.range as vscode.Range;
    expect([range.start.line, range.start.character, range.end.character]).toEqual([1, 8, 18]);
  });

  it("expands macros defined in another file of the project", async () => {
    // An unknown \R would be drawn in the error colour; a defined one is not.
    expect(svgOf(await hover("\\input{macros}\nWe have $\\R|^n$."))).not.toContain("#f85149");
    expect(svgOf(await hover("We have $\\R|^n$.", "/elsewhere/a.tex"))).toContain("#f85149");
  });

  it("uses the file's own macros outside a project", async () => {
    const svg = svgOf(await hover("\\newcommand{\\R}{\\mathbb{R}}\n$\\R|$", "/elsewhere/a.tex"));
    expect(svg).not.toContain("#f85149");
  });

  it("shows TeX's error for math that does not parse, and nothing outside math", async () => {
    expect(markdownOf(await hover("$\\frac{a|}$", "/elsewhere/a.tex"))).toMatch(/^Math preview: /);
    expect(await hover("plain| text", "/elsewhere/a.tex")).toBeUndefined();
  });
});
