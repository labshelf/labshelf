import * as vscode from "vscode";

import { replaceCitedKey } from "../../../../src/writing/preview/citationFixes/replaceCitedKey";
import { fakeLogger } from "../../../support/writingFixtures";

function openLine(text: string): void {
  (vscode.workspace as unknown as { openTextDocument: jest.Mock }).openTextDocument = jest.fn(async () => ({
    lineCount: 10,
    lineAt: () => ({ text }),
  }));
}

function fix(key: string, replacement: string, file = "main.tex", line = 3) {
  return { kind: "replace" as const, key, replacement, file, line };
}

describe("replaceCitedKey", () => {
  beforeEach(() => jest.clearAllMocks());

  it("changes only the missing key of a multi-key cite", async () => {
    openLine(String.raw`As shown \citep[p.~2]{smith2020, jonse2021,doe2019} here.`);
    await replaceCitedKey({ projectFolder: "/proj", logger: fakeLogger() }, fix("jonse2021", "jones2021"));

    const edit = (vscode.workspace.applyEdit as jest.Mock).mock.calls[0][0];
    expect(edit.replacements).toHaveLength(1);
    const { range, text, uri } = edit.replacements[0];
    expect(text).toBe("jones2021");
    expect(uri.fsPath).toBe("/proj/main.tex");
    const line = String.raw`As shown \citep[p.~2]{smith2020, jonse2021,doe2019} here.`;
    expect(line.slice(range.start.character, range.end.character)).toBe("jonse2021");
    expect(range.start.line).toBe(2);
  });

  it("changes a Typst @key without touching a longer key that shares its prefix", async () => {
    const line = "See @smith2020b and @smith2020.";
    openLine(line);
    await replaceCitedKey({ projectFolder: "/proj", logger: fakeLogger() }, fix("smith2020", "smyth2020", "main.typ"));

    const { range } = (vscode.workspace.applyEdit as jest.Mock).mock.calls[0][0].replacements[0];
    expect(range.start.character).toBe(line.lastIndexOf("smith2020"));
  });

  it("warns and edits nothing when the key is not cited on the line", async () => {
    openLine(String.raw`\cite{other}`);
    const logger = fakeLogger();
    await replaceCitedKey({ projectFolder: "/proj", logger }, fix("missing", "found"));

    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.any(String), expect.objectContaining({ file: "main.tex", line: 3 }));
  });
});
