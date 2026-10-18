// Tests that the web build's ILatexHelper forwards each call to the editor page's helper command.
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

  it("forwards compile with the project and returns the page's result", async () => {
    const result = { status: "failed", problems: [] };
    execute.mockResolvedValueOnce(result);
    const project = { projectId: "paper", main: "main.tex", engine: "pdflatex" as const, files: [] };
    expect(await createHostPageLatexHelper().compile(project, () => undefined)).toBe(result);
    expect(execute).toHaveBeenCalledWith(LATEX_HELPER_COMMAND, "compile", project);
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
