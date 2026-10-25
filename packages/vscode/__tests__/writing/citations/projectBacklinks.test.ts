// Tests that the backlink index is rebuilt, debounced, when projects change or a project source is saved or edited.
import * as vscode from "vscode";

import { ProjectBacklinks } from "../../../src/writing/citations/index";
import { fakeDocument } from "../../support/textDocument";
import { fakeHost, fakeLogger, fakeProjects, readyEntry } from "../../support/writingFixtures";

const workspace = vscode.workspace as unknown as {
  _fireDocumentEvent: (kind: string, document: vscode.TextDocument) => void;
  _fireTextDocumentChange: (event: { document: vscode.TextDocument }) => void;
};
const link = { project: "survey", file: "main.tex", line: 2, section: "Intro" };

const created: ProjectBacklinks[] = [];

function setup(logger = fakeLogger()) {
  const changed = new vscode.EventEmitter<void>();
  const entries = [readyEntry("/lib/projects/survey")];
  const projects = { ...fakeProjects(entries), onDidChange: changed.event };
  const build = projects.data.projectBacklinks;
  build.mockResolvedValue(new Map([["smith2020", [link]]]));
  const index = new ProjectBacklinks(projects as never, fakeHost(logger));
  const onChange = jest.fn();
  index.onDidChange(onChange);
  created.push(index);
  return { index, changed, onChange, logger, build };
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => {
  // The vscode double keeps document listeners across tests.
  for (const index of created.splice(0)) { index.dispose(); }
  jest.useRealTimers();
});

describe("ProjectBacklinks", () => {
  it("rebuilds once, a second after the project list changes, and reads open editors", async () => {
    const { index, changed, onChange, build } = setup();
    changed.fire();
    changed.fire();
    await jest.advanceTimersByTimeAsync(999);
    expect(build).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0]![1]).toEqual(expect.objectContaining({ text: expect.any(Function) }));
    expect(index.index().get("smith2020")).toEqual([link]);
    expect(index.projectFolder("survey")).toBe("/lib/projects/survey");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("rebuilds when a .tex file inside a project is saved or edited, not for other files", async () => {
    const { onChange, build } = setup();
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
    const { index, changed, onChange, logger, build } = setup();
    changed.fire();
    await jest.advanceTimersByTimeAsync(1000);
    build.mockRejectedValue(new Error("disk"));
    changed.fire();
    await jest.advanceTimersByTimeAsync(1000);
    expect(logger.error).toHaveBeenCalledWith("writing/citations", expect.any(Error), { action: "rebuild" });
    expect(index.index().get("smith2020")).toEqual([link]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("stops listening when disposed", async () => {
    const { index, changed, build } = setup();
    index.dispose();
    workspace._fireDocumentEvent("save", fakeDocument("/lib/projects/survey/main.tex", ""));
    await jest.advanceTimersByTimeAsync(1000);
    changed.fire();
    expect(build).not.toHaveBeenCalled();
  });
});
