// Tests that the source line behind a preview point comes from the open editor first, then from the workspace file system.
import * as vscode from "vscode";

import { sourceLineAt } from "../../../../src/writing/preview/citations/sourceLineAt";

const point = { page: 1, x: 10, y: 20 };
const found = (file: string, line: number) => ({ status: "found", index: { file, line } });

jest.mock("@labshelf/core", () => ({
  ...jest.requireActual("@labshelf/core"),
  sourceAt: (index: { file: string; line: number }) => index,
}));

const readFile = vscode.workspace.fs.readFile as jest.Mock;
const lookup = (file: string, line = 3) => async () => found(file, line) as never;

afterEach(() => {
  (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [];
  readFile.mockReset();
});

describe("sourceLineAt", () => {
  it("reads the file through the workspace file system, decoded as UTF-8", async () => {
    readFile.mockResolvedValue(new TextEncoder().encode("café\nline"));
    const result = await sourceLineAt(lookup("/ws/main.tex"), point as never);
    expect(result).toEqual({ file: "/ws/main.tex", text: "café\nline", line: 3 });
    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ fsPath: "/ws/main.tex" }));
  });

  it("prefers the open document's unsaved text over the file", async () => {
    (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [{ uri: { fsPath: "/ws/main.tex" }, getText: () => "unsaved" }];
    expect(await sourceLineAt(lookup("/ws/main.tex"), point as never)).toEqual({ file: "/ws/main.tex", text: "unsaved", line: 3 });
    expect(readFile).not.toHaveBeenCalled();
  });

  it("returns undefined when SyncTeX data is not found", async () => {
    expect(await sourceLineAt(async () => ({ status: "missing" }) as never, point as never)).toBeUndefined();
    expect(readFile).not.toHaveBeenCalled();
  });
});
