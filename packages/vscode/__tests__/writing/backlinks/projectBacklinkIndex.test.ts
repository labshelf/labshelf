// Tests that the backlink index is rebuilt, debounced, when projects change or a project source is saved or edited.
import * as vscode from "vscode";

import { projectBacklinks } from "@labshelf/core/node";
import { ProjectBacklinkIndex } from "../../../src/writing/backlinks";
import { fakeDocument } from "../../support/textDocument";
import { fakeHost, fakeLogger, readyEntry } from "../../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({ ...jest.requireActual("@labshelf/core/node"), projectBacklinks: jest.fn() }));

const workspace = vscode.workspace as unknown as {
  _fireDocumentEvent: (kind: string, document: vscode.TextDocument) => void;
  _fireTextDocumentChange: (event: { document: vscode.TextDocument }) => void;
};
const build = projectBacklinks as jest.Mock;
const link = { project: "survey", file: "main.tex", line: 2, section: "Intro" };

const created: ProjectBacklinkIndex[] = [];

function setup(logger = fakeLogger()) {
  const changed = new vscode.EventEmitter<void>();
  const entries = [readyEntry("/lib/projects/survey")];
  const index = new ProjectBacklinkIndex({ list: () => entries, onDidChange: changed.event } as never, fakeHost(logger));
  const onChange = jest.fn();
  index.onDidChange(onChange);
  created.push(index);
  return { index, changed, onChange, logger };
}

beforeEach(() => {
  jest.useFakeTimers();
  build.mockReset().mockResolvedValue(new Map([["smith2020", [link]]]));
});
afterEach(() => {
  // The vscode double keeps document listeners across tests.
  for (const index of created.splice(0)) { index.dispose(); }
  jest.useRealTimers();
});

describe("ProjectBacklinkIndex", () => {
  it("rebuilds once, a second after the project list changes, and reads open editors", async () => {
    const { index, changed, onChange } = setup();
    changed.fire();
    changed.fire();
    await jest.advanceTimersByTimeAsync(999);
    expect(build).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0]![2]).toEqual(expect.objectContaining({ text: expect.any(Function) }));
    expect(index.index().get("smith2020")).toEqual([link]);
    expect(index.projectFolder("survey")).toBe("/lib/projects/survey");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("rebuilds when a .tex file inside a project is saved or edited, not for other files", async () => {
    const { onChange } = setup();
    workspace._fireDocumentEvent("save", fakeDocument("/lib/projects/survey/notes.md", ""));
    workspace._fireDocumentEvent("save", fakeDocument("/elsewhere/main.tex", ""));
    await jest.advanceTimersByTimeAsync(1000);
    expect(build).not.toHaveBeenCalled();

    workspace._fireDocumentEvent("save", fakeDocument("/lib/projects/survey/main.tex", ""));
    await jest.advanceTimersByTimeAsync(1000);
    workspace._fireTextDocumentChange({ document: fakeDocument("/lib/projects/survey/sections/intro.typ", "") });
    await jest.advanceTimersByTimeAsync(1000);
    expect(build).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("logs a failed rebuild and keeps the last index", async () => {
    const { index, changed, onChange, logger } = setup();
    changed.fire();
    await jest.advanceTimersByTimeAsync(1000);
    build.mockRejectedValue(new Error("disk"));
    changed.fire();
    await jest.advanceTimersByTimeAsync(1000);
    expect(logger.error).toHaveBeenCalledWith("writing/backlinks", expect.any(Error), { action: "rebuild" });
    expect(index.index().get("smith2020")).toEqual([link]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("stops listening when disposed", async () => {
    const { index, changed } = setup();
    index.dispose();
    workspace._fireDocumentEvent("save", fakeDocument("/lib/projects/survey/main.tex", ""));
    await jest.advanceTimersByTimeAsync(1000);
    changed.fire();
    expect(build).not.toHaveBeenCalled();
  });
});
