// Tests that the Typst providers map the language service's offsets, kinds, snippets and files to VS Code types.
import * as vscode from "vscode";

import type { TypstLanguageService } from "@labshelf/core/typst/language";
import { createTypstCompletionProvider } from "../../../../src/writing/typst/language/typstCompletionProvider";
import { createTypstDefinitionProvider } from "../../../../src/writing/typst/language/typstDefinitionProvider";
import type { TypstContextOf } from "../../../../src/writing/typst/language/typstDocumentContext";
import { createTypstHoverProvider } from "../../../../src/writing/typst/language/typstHoverProvider";
import { fakeDocument } from "../../../support/textDocument";

const TEXT = "= Intro\n#le";
const document = fakeDocument("/p/main.typ", TEXT);
const token = undefined as never;

function setup(service: Partial<TypstLanguageService>): TypstContextOf {
  return () => ({ service: service as TypstLanguageService, path: "main.typ", root: vscode.Uri.file("/p") });
}

describe("createTypstCompletionProvider", () => {
  const triggered = { triggerKind: vscode.CompletionTriggerKind.TriggerCharacter, triggerCharacter: "#" };

  it("passes UTF-16 offsets and the explicit flag, and maps ranges, kinds and snippets", async () => {
    const complete = jest.fn(async () => ({
      from: 9, to: 11,
      options: [
        { label: "let", kind: "keyword" as const, insert: "let ${1:name} = ${2}", snippet: true, detail: "binding", doc: "Binds." },
        { label: "main.typ", kind: "file" as const, insert: "main.typ", snippet: false },
      ],
    }));
    const provider = createTypstCompletionProvider(setup({ complete }));
    const items = await provider.provideCompletionItems(document, new vscode.Position(1, 3), token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined }) as vscode.CompletionItem[];
    expect(complete).toHaveBeenCalledWith("main.typ", TEXT, 11, true);
    expect(items.map((item) => item.kind)).toEqual([vscode.CompletionItemKind.Keyword, vscode.CompletionItemKind.File]);
    expect(items[0]!.range).toEqual(new vscode.Range(new vscode.Position(1, 1), new vscode.Position(1, 3)));
    expect(items[0]!.insertText).toEqual(new vscode.SnippetString("let ${1:name} = ${2}"));
    expect(items[0]!.detail).toBe("binding");
    expect((items[0]!.documentation as vscode.MarkdownString).value).toBe("Binds.");
    expect(items[1]!.insertText).toBe("main.typ");
    expect(items.map((item) => item.sortText)).toEqual(["00000", "00001"]);
  });

  it("is not explicit for a trigger character and offers nothing when the service has nothing", async () => {
    const complete = jest.fn(async () => null);
    const provider = createTypstCompletionProvider(setup({ complete }));
    expect(await provider.provideCompletionItems(document, new vscode.Position(1, 0), token, triggered)).toBeUndefined();
    expect(complete).toHaveBeenCalledWith("main.typ", TEXT, 8, false);
  });
});

describe("createTypstHoverProvider", () => {
  it("returns the markdown over the range of the hovered symbol", async () => {
    const hover = jest.fn(async () => ({ from: 0, to: 7, text: "```typst\nheading\n```" }));
    const result = await createTypstHoverProvider(setup({ hover })).provideHover(document, new vscode.Position(0, 2), token) as vscode.Hover;
    expect(hover).toHaveBeenCalledWith("main.typ", TEXT, 2);
    expect((result.contents as unknown as vscode.MarkdownString).value).toBe("```typst\nheading\n```");
    expect(result.range).toEqual(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 7)));
  });
});

describe("createTypstDefinitionProvider", () => {
  it("locates a definition in the same document without opening it", async () => {
    const definition = jest.fn(async () => ({ path: "main.typ", from: 2, to: 7, line: 0 }));
    const open = jest.fn();
    (vscode.workspace as unknown as { openTextDocument: jest.Mock }).openTextDocument = open;
    const location = await createTypstDefinitionProvider(setup({ definition })).provideDefinition(document, new vscode.Position(1, 1), token) as vscode.Location;
    expect(location.uri.fsPath).toBe("/p/main.typ");
    expect(location.range).toEqual(new vscode.Range(new vscode.Position(0, 2), new vscode.Position(0, 7)));
    expect(open).not.toHaveBeenCalled();
  });

  it("maps offsets through the text of a definition in another project file", async () => {
    const definition = jest.fn(async () => ({ path: "lib/util.typ", from: 4, to: 6, line: 1 }));
    const other = fakeDocument("/p/lib/util.typ", "ab\ncdef");
    (vscode.workspace as unknown as { openTextDocument: jest.Mock }).openTextDocument = jest.fn(async () => other);
    const location = await createTypstDefinitionProvider(setup({ definition })).provideDefinition(document, new vscode.Position(1, 1), token) as vscode.Location;
    expect(location.uri.fsPath).toBe("/p/lib/util.typ");
    expect(location.range).toEqual(new vscode.Range(new vscode.Position(1, 1), new vscode.Position(1, 3)));
  });

  it("answers nothing when the service finds no definition", async () => {
    expect(await createTypstDefinitionProvider(setup({ definition: async () => null })).provideDefinition(document, new vscode.Position(0, 0), token)).toBeUndefined();
  });
});
