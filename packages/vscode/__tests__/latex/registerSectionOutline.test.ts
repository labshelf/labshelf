// Tests that the outline nests sections by level and ends each section at the next heading of the same or a higher level.
import * as vscode from "vscode";

import {
  registerSectionOutline,
  sectionSymbols,
} from "../../src/latex/registerSectionOutline";
import { at, latexProject, resetOpenDocuments, restoreDiskReads } from "../support/latexProjectFixtures";
import { fakeDocument } from "../support/textDocument";

const TEXT = [
  "\\chapter{One}",
  "\\section{Alpha}",
  "\\subsection{Deep}",
  "\\section*{Beta}",
  "\\chapter{Two}",
  "\\paragraph{Loose}",
].join("\n");

const END = new vscode.Position(5, 18);

afterEach(() => { resetOpenDocuments(); restoreDiskReads(); });

describe("sectionSymbols", () => {
  it("nests sections under the nearest heading of a higher level", () => {
    const roots = sectionSymbols(TEXT, END);
    expect(roots.map((symbol) => symbol.name)).toEqual(["One", "Two"]);
    expect(roots[0]!.children.map((symbol) => symbol.name)).toEqual(["Alpha", "Beta"]);
    expect(roots[0]!.children[0]!.children.map((symbol) => symbol.name)).toEqual(["Deep"]);
    expect(roots[1]!.children.map((symbol) => symbol.name)).toEqual(["Loose"]);
  });

  it("ranges from the command to the next heading of the same or a higher level, or the end of the file", () => {
    const [one, two] = sectionSymbols(TEXT, END);
    expect([one!.range.start.line, one!.range.end.line]).toEqual([0, 4]);
    expect([one!.children[0]!.range.start.line, one!.children[0]!.range.end.line]).toEqual([1, 3]);
    expect(two!.range.end).toBe(END);
  });

  it("selects the heading command and gives each level its own kind", () => {
    const [one] = sectionSymbols(TEXT, END);
    const alpha = one!.children[0]!;
    expect(alpha.selectionRange.start).toEqual(new vscode.Position(1, 0));
    expect(alpha.selectionRange.end.character).toBe("\\section{Alpha}".length);
    expect(new Set([one!.kind, alpha.kind, alpha.children[0]!.kind]).size).toBe(3);
  });

  it("starts a part above chapters and names an empty heading", () => {
    const [part] = sectionSymbols("\\part{P}\n\\chapter{C}\n\\section{}", new vscode.Position(2, 10));
    expect(part!.children[0]!.name).toBe("C");
    expect(part!.children[0]!.children[0]!.name).toBe("(untitled)");
  });

  it("lists nothing for a text without headings", () => {
    expect(sectionSymbols("Just prose.", new vscode.Position(0, 11))).toEqual([]);
  });
});

describe("registerSectionOutline", () => {
  function provider() {
    const { sources } = latexProject({ "main.tex": "" });
    registerSectionOutline({ subscriptions: [] } as never, sources);
    const [selector, registered] = (vscode.languages.registerDocumentSymbolProvider as jest.Mock).mock.calls.at(-1)!;
    return { selector, registered: registered as vscode.DocumentSymbolProvider };
  }

  it("lists the sections of a file inside a project", () => {
    const { selector, registered } = provider();
    expect(selector).toEqual({ scheme: "file", pattern: "**/*.tex" });
    const symbols = registered.provideDocumentSymbols(fakeDocument(at("a.tex"), "\\section{Intro}"), undefined as never);
    expect((symbols as vscode.DocumentSymbol[]).map((symbol) => symbol.name)).toEqual(["Intro"]);
  });

  it("lists nothing for a file outside a project", () => {
    const { registered } = provider();
    expect(registered.provideDocumentSymbols(fakeDocument("/elsewhere/a.tex", "\\section{Intro}"), undefined as never)).toBeUndefined();
  });
});
