// Tests that go-to-definition from a reference lands on every matching \label of the project.
import * as vscode from "vscode";

import { ReferenceDefinitionProvider } from "../../../src/latex/labels/referenceDefinition";
import { at, latexProject, resetOpenDocuments, restoreDiskReads } from "../../support/latexProjectFixtures";
import { fakeDocument, withCursor } from "../../support/textDocument";

const DISK = {
  "main.tex": "\\input{sections/a}",
  "sections/a.tex": "\\section{A}\n\\label{sec:a}",
};

afterEach(() => { resetOpenDocuments(); restoreDiskReads(); });

async function definition(marked: string) {
  const { sources } = latexProject(DISK);
  const { text, position } = withCursor(marked);
  return new ReferenceDefinitionProvider(sources).provideDefinition(fakeDocument(at("main.tex"), text), position);
}

describe("ReferenceDefinitionProvider", () => {
  it("points a reference at the name inside its \\label", async () => {
    const [location] = (await definition("See \\ref{sec:|a}."))!;
    expect(location!.uri.fsPath).toBe(at("sections/a.tex"));
    const range = location!.range as vscode.Range;
    expect([range.start.line, range.start.character, range.end.character]).toEqual([1, 7, 12]);
  });

  it("works on any name of a multi-name command", async () => {
    expect(await definition("\\cref{x, sec:a|}")).toHaveLength(1);
  });

  it("finds nothing for an undefined label, text outside a reference or a file outside a project", async () => {
    expect(await definition("\\ref{nope|}")).toBeUndefined();
    expect(await definition("plain| \\ref{sec:a}")).toBeUndefined();
    const { sources } = latexProject(DISK);
    const { text, position } = withCursor("\\ref{sec:a|}");
    expect(await new ReferenceDefinitionProvider(sources).provideDefinition(fakeDocument("/elsewhere/a.tex", text), position)).toBeUndefined();
  });
});
