// Tests that the web build's Typst compiles go to the editor page's command and come back with their PDF decoded.
import * as vscode from "vscode";

import { compileTypstOnHostPage, TYPST_COMPILE_COMMAND } from "../../../src/writing/web/hostPageTypstCompiler";

const execute = vscode.commands.executeCommand as jest.Mock;

beforeEach(() => execute.mockReset());

describe("compileTypstOnHostPage", () => {
  it("sends the request to the page's command and decodes the PDF it returns", async () => {
    execute.mockResolvedValueOnce({ status: "succeeded", pdfBase64: "JVBERg==", problems: [], cites: [] });
    const request = { projectId: "cv", main: "main.typ", sources: [{ path: "main.typ", text: "= CV" }] };
    expect(await compileTypstOnHostPage(request)).toEqual({ status: "succeeded", pdf: new Uint8Array([37, 80, 68, 70]), problems: [], cites: [] });
    expect(execute).toHaveBeenCalledWith(TYPST_COMPILE_COMMAND, request);
  });

  it("rejects when the page has no Typst compiler", async () => {
    execute.mockRejectedValueOnce(new Error(`command '${TYPST_COMPILE_COMMAND}' not found`));
    await expect(compileTypstOnHostPage({ projectId: "cv", main: "main.typ", sources: [] })).rejects.toThrow(/not found/);
  });
});
