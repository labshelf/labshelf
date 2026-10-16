// Verifies that the cursor of the active project file is saved after it settles, on save, and only for files in a ready project.
import * as vscode from "vscode";

import { writeProjectCursor } from "@labshelf/core/node";

import { registerProjectCursorRecorder } from "../../src/continue/projectCursorRecorder";
import type { WritingProjects } from "../../src/writing";
import { fakeLogger, fakeProjects, readyEntry } from "../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({ ...jest.requireActual("@labshelf/core/node"), writeProjectCursor: jest.fn(async () => {}) }));
const write = writeProjectCursor as jest.Mock;

const win = vscode.window as unknown as {
  activeTextEditor: unknown; _fireActiveEditorChange: () => void; _fireSelectionChange: () => void;
};

function edit(fsPath: string, line = 3, character = 7, scheme = "file"): void {
  win.activeTextEditor = {
    document: { uri: Object.assign(vscode.Uri.file(fsPath), { scheme }) },
    selection: { active: { line, character } },
  };
}

const contexts: vscode.ExtensionContext[] = [];

function setup(entries = [readyEntry("/lib/projects/a")]) {
  const projects = fakeProjects(entries);
  const logger = fakeLogger();
  const onRecorded = jest.fn();
  const context = { subscriptions: [] as { dispose(): void }[] } as unknown as vscode.ExtensionContext;
  contexts.push(context);
  registerProjectCursorRecorder(context, { projects: projects as unknown as WritingProjects, logger: () => logger, onRecorded });
  return { projects, logger, onRecorded, context };
}

beforeEach(() => {
  jest.useFakeTimers();
  write.mockClear();
  win.activeTextEditor = undefined;
});
afterEach(() => {
  // Each registration listens on the shared mock window, so it is disposed before the next test.
  for (const context of contexts.splice(0)) { context.subscriptions.forEach((d) => d.dispose()); }
  jest.useRealTimers();
});

describe("registerProjectCursorRecorder", () => {
  it("saves the project-relative file and the cursor once the cursor settles", async () => {
    const { onRecorded } = setup();
    edit("/lib/projects/a/sec/intro.tex");
    win._fireSelectionChange();
    win._fireSelectionChange();
    await jest.advanceTimersByTimeAsync(1999);
    expect(write).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("/lib/projects/a", { file: "sec/intro.tex", line: 3, character: 7, updatedAt: expect.any(String) });
    expect(onRecorded).toHaveBeenCalledTimes(1);
  });

  it("does not write the same position twice", async () => {
    setup();
    edit("/lib/projects/a/main.tex");
    win._fireActiveEditorChange();
    await jest.advanceTimersByTimeAsync(2100);
    win._fireSelectionChange();
    await jest.advanceTimersByTimeAsync(2100);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("saves immediately on save", async () => {
    setup();
    edit("/lib/projects/a/main.tex");
    (vscode.workspace as unknown as { _fireDocumentEvent: (k: string, d: unknown) => void })._fireDocumentEvent("save", {});
    await jest.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("ignores files outside every project and non-file documents", async () => {
    const { projects } = setup();
    edit("/elsewhere/notes.md");
    win._fireActiveEditorChange();
    await jest.advanceTimersByTimeAsync(2100);
    edit("/elsewhere/other.md");
    win._fireActiveEditorChange();
    await jest.advanceTimersByTimeAsync(2100);
    edit("/lib/projects/a/main.tex", 0, 0, "untitled");
    win._fireActiveEditorChange();
    await jest.advanceTimersByTimeAsync(2100);
    expect(write).not.toHaveBeenCalled();
    expect(projects.reload).not.toHaveBeenCalled();
  });

  it("logs a failed write instead of throwing", async () => {
    const { logger, onRecorded } = setup();
    write.mockRejectedValueOnce(new Error("corrupt"));
    edit("/lib/projects/a/main.tex");
    win._fireActiveEditorChange();
    await jest.advanceTimersByTimeAsync(2100);
    expect(logger.error).toHaveBeenCalledWith("continue", expect.any(Error), expect.objectContaining({ file: "main.tex" }));
    expect(onRecorded).not.toHaveBeenCalled();
  });
});
