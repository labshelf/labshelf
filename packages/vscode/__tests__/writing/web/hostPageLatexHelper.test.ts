// Tests that the web build's EditorHostLatexHelper forwards each call to the editor page's helper command.
import * as vscode from "vscode";

import { createHostPageLatexHelper, LATEX_HELPER_COMMAND } from "../../../src/writing/web/hostPageLatexHelper";

const execute = vscode.commands.executeCommand as jest.Mock;

beforeEach(() => execute.mockReset());

describe("createHostPageLatexHelper", () => {
  it("forwards connect and remembers the status it returned", async () => {
    execute.mockResolvedValueOnce({ state: "not-installed" });
    const helper = createHostPageLatexHelper();
    expect(helper.status()).toBeUndefined();
    expect(await helper.connect()).toEqual({ state: "not-installed" });
    expect(execute).toHaveBeenCalledWith(LATEX_HELPER_COMMAND, "connect");
    expect(helper.status()).toEqual({ state: "not-installed" });
  });

  it("forwards compile with the file bytes as base64 and decodes the page's PDF", async () => {
    execute.mockResolvedValueOnce({ status: "succeeded", problems: [], pdfBase64: "JVBERg==" });
    const project = { projectId: "paper", main: "main.tex", engine: "pdflatex" as const, files: [{ path: "main.tex", bytes: new Uint8Array([104, 105]) }] };
    expect(await createHostPageLatexHelper().compile(project, () => undefined)).toEqual({ status: "succeeded", problems: [], pdf: new Uint8Array([37, 80, 68, 70]) });
    expect(execute).toHaveBeenCalledWith(LATEX_HELPER_COMMAND, "compile", { projectId: "paper", main: "main.tex", engine: "pdflatex", files: [{ path: "main.tex", base64: "aGk=" }] });
  });

  it("forwards cancel and the installs", async () => {
    const helper = createHostPageLatexHelper();
    await helper.cancel("paper");
    await helper.installTex("tinytex", () => undefined);
    await helper.installAllPackages(() => undefined);
    expect(execute.mock.calls).toEqual([[LATEX_HELPER_COMMAND, "cancel", "paper"], [LATEX_HELPER_COMMAND, "installTex", "tinytex"], [LATEX_HELPER_COMMAND, "installAllPackages"]]);
  });

  it("rejects when the page has no helper command", async () => {
    execute.mockRejectedValueOnce(new Error("command not found"));
    await expect(createHostPageLatexHelper().connect()).rejects.toThrow("command not found");
  });
});
