// Tests that label completion fires inside the ref family only and lists every label of the project.
import * as vscode from "vscode";

import { ReferenceCompletionProvider } from "../../../src/latex/labels/referenceCompletion";
import { latexProject, resetOpenDocuments, restoreDiskReads } from "../../support/latexProjectFixtures";
import { fakeDocument, withCursor } from "../../support/textDocument";
import { at } from "../../support/latexProjectFixtures";

const DISK = {
  "main.tex": "\\input{sections/a}\n\\input{sections/b}",
  "sections/a.tex": "\\section{A}\\label{sec:a}\n\n\\begin{equation}\\label{eq:one} x \\end{equation}",
  "sections/b.tex": "\\label{sec:b}\n\\label{sec:a}",
};

afterEach(() => { resetOpenDocuments(); restoreDiskReads(); });

async function complete(marked: string) {
  const { sources } = latexProject(DISK);
  const { text, position } = withCursor(marked);
  return new ReferenceCompletionProvider(sources).provideCompletionItems(fakeDocument(at("sections/c.tex"), text), position);
}

describe("ReferenceCompletionProvider", () => {
  it("lists each label of the whole project once inside \\ref{", async () => {
    const items = (await complete("See \\ref{|"))!;
    expect(items.map((item) => item.label)).toEqual(["sec:a", "eq:one", "sec:b"]);
    expect(items[0]!.kind).toBe(vscode.CompletionItemKind.Reference);
  });

  it("describes a label with its file and line, and the source line", async () => {
    const eq = (await complete("\\eqref{|"))!.find((item) => item.label === "eq:one")!;
    expect(eq.detail).toBe("sections/a.tex:3");
    expect(eq.documentation).toBe("\\begin{equation}\\label{eq:one} x \\end{equation}");
  });

  it("replaces the partial name typed so far", async () => {
    const [item] = (await complete("\\ref{sec:|"))!;
    const range = item!.range as vscode.Range;
    expect([range.start.character, range.end.character]).toEqual([5, 9]);
  });

  it("completes the next name of a multi-name command", async () => {
    const items = (await complete("\\cref{sec:a, e|"))!;
    expect(items).toHaveLength(3);
    const range = items[0]!.range as vscode.Range;
    expect([range.start.character, range.end.character]).toEqual([13, 14]);
  });

  it("offers nothing outside a ref command", async () => {
    expect(await complete("Plain text, with commas|")).toBeUndefined();
    expect(await complete("\\label{|")).toBeUndefined();
    expect(await complete("\\ref{sec:a}| more")).toBeUndefined();
    expect(await complete("% \\ref{|")).toBeUndefined();
  });

  it("offers nothing for a file outside a project", async () => {
    const { sources } = latexProject(DISK);
    const { text, position } = withCursor("\\ref{|");
    expect(await new ReferenceCompletionProvider(sources).provideCompletionItems(fakeDocument("/elsewhere/a.tex", text), position)).toBeUndefined();
  });
});
