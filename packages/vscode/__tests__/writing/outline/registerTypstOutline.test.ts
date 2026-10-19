// Tests that the Typst outline provider lists the headings of .typ files.
import * as vscode from "vscode";

import { registerTypstOutline } from "../../../src/writing/outline";
import { fakeDocument } from "../../support/textDocument";

const register = vscode.languages.registerDocumentSymbolProvider as jest.Mock;

beforeEach(() => { register.mockClear(); });

describe("registerTypstOutline", () => {
  it("lists the headings of .typ files", () => {
    registerTypstOutline();
    const [selector, provider] = register.mock.calls[0]!;
    expect(selector).toEqual({ scheme: "file", pattern: "**/*.typ" });
    const symbols = (provider as vscode.DocumentSymbolProvider)
      .provideDocumentSymbols(fakeDocument("/p/a.typ", "= Intro"), undefined as never) as vscode.DocumentSymbol[];
    expect(symbols.map((symbol) => symbol.name)).toEqual(["Intro"]);
  });
});
