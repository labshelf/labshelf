// Tests that the Typst outline provider is registered only when Tinymist is not installed.
import * as vscode from "vscode";

import { registerTypstOutline } from "../../../src/writing/outline";
import { fakeDocument } from "../../support/textDocument";

const register = vscode.languages.registerDocumentSymbolProvider as jest.Mock;
const getExtension = vscode.extensions.getExtension as jest.Mock;

beforeEach(() => { register.mockClear(); getExtension.mockReset(); getExtension.mockReturnValue(undefined); });

describe("registerTypstOutline", () => {
  it("registers a symbol provider for .typ files without Tinymist", () => {
    const disposable = registerTypstOutline();
    expect(getExtension).toHaveBeenCalledWith("myriad-dreamin.tinymist");
    expect(register).toHaveBeenCalledTimes(1);
    const [selector, provider] = register.mock.calls[0]!;
    expect(selector).toEqual({ scheme: "file", pattern: "**/*.typ" });
    const symbols = (provider as vscode.DocumentSymbolProvider)
      .provideDocumentSymbols(fakeDocument("/p/a.typ", "= Intro"), undefined as never) as vscode.DocumentSymbol[];
    expect(symbols.map((symbol) => symbol.name)).toEqual(["Intro"]);
    expect(typeof disposable.dispose).toBe("function");
  });

  it("registers nothing when Tinymist is installed", () => {
    getExtension.mockReturnValue({ id: "myriad-dreamin.tinymist" });
    const disposable = registerTypstOutline();
    expect(register).not.toHaveBeenCalled();
    expect(() => disposable.dispose()).not.toThrow();
  });
});
