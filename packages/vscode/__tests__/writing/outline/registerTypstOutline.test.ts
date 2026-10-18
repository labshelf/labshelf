// Tests that the Typst outline provider answers only until the Typst language server runs.
import * as vscode from "vscode";

import { registerTypstOutline } from "../../../src/writing/outline";
import { setLanguageServerRunning } from "../../../src/writing/typst/languageServerState";
import { fakeDocument } from "../../support/textDocument";

const register = vscode.languages.registerDocumentSymbolProvider as jest.Mock;

beforeEach(() => { register.mockClear(); setLanguageServerRunning(false); });
afterAll(() => setLanguageServerRunning(false));

function provide(): vscode.DocumentSymbol[] {
  registerTypstOutline();
  const [selector, provider] = register.mock.calls[0]!;
  expect(selector).toEqual({ scheme: "file", pattern: "**/*.typ" });
  return (provider as vscode.DocumentSymbolProvider)
    .provideDocumentSymbols(fakeDocument("/p/a.typ", "= Intro"), undefined as never) as vscode.DocumentSymbol[];
}

describe("registerTypstOutline", () => {
  it("lists the headings of .typ files while the language server is not running", () => {
    expect(provide().map((symbol) => symbol.name)).toEqual(["Intro"]);
  });

  it("answers nothing while the language server runs, since it lists them", () => {
    setLanguageServerRunning(true);
    expect(provide()).toEqual([]);
  });
});
