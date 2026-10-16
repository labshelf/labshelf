// Tests the Versions view: the open project's versions newest first, the count in the view description and the hasVersions context key.
import * as vscode from "vscode";

import type { ProjectVersion } from "@labshelf/core";
import type { ReadyProject } from "../../../src/writing/figures";
import { ProjectVersionsView, type VersionRow } from "../../../src/writing/versions/projectVersionsView";
import { readyEntry } from "../../support/writingFixtures";

const executeCommand = vscode.commands.executeCommand as jest.Mock;
const flush = () => new Promise((resolve) => setImmediate(resolve));

function version(slug: string, created: string): ProjectVersion {
  return { slug, name: slug, created, pdfPath: `/p/${slug}.pdf`, sourcesDir: `/p/${slug}/sources` };
}

function setup(open: boolean, versions: ProjectVersion[] = [], pdfExists = async () => true) {
  const project = readyEntry("/code/paper") as ReadyProject;
  const sessionChanged = new vscode.EventEmitter<ReadyProject | undefined>();
  const session = { project: open ? project : undefined, onDidChange: sessionChanged.event };
  const listVersions = jest.fn(async () => versions);
  const exists = jest.fn(pdfExists);
  const view = new ProjectVersionsView({ session, listVersions, pdfExists: exists });
  const treeView: { description?: string } = {};
  view.attach(treeView as vscode.TreeView<VersionRow>);
  return { view, treeView, session, listVersions, exists, sessionChanged, project };
}

const hasVersionsKey = (): unknown => executeCommand.mock.calls.filter(([cmd, key]) => cmd === "setContext" && key === "labshelf.writing.hasVersions").at(-1)?.[2];

beforeEach(() => jest.clearAllMocks());

describe("ProjectVersionsView", () => {
  it("has no rows, an empty description and a false key when no project is open", async () => {
    const { view, treeView, listVersions } = setup(false);
    await flush();
    expect(view.getChildren()).toEqual([]);
    expect(listVersions).not.toHaveBeenCalled();
    expect(treeView.description).toBe("");
    expect(hasVersionsKey()).toBe(false);
  });

  it("has an empty description and a false key when the project has no versions", async () => {
    const { view, treeView, listVersions, project } = setup(true);
    await flush();
    expect(listVersions).toHaveBeenCalledWith(project.folder);
    expect(view.getChildren()).toEqual([]);
    expect(treeView.description).toBe("");
    expect(hasVersionsKey()).toBe(false);
  });

  it("lists versions newest first with the count as description and a true key", async () => {
    const old = version("old", "2026-01-01T00:00:00Z");
    const recent = version("recent", "2026-03-01T00:00:00Z");
    const middle = version("middle", "2026-02-01T00:00:00Z");
    const { view, treeView, project } = setup(true, [old, recent, middle]);
    await flush();
    expect(view.getChildren()).toEqual([
      { project, version: recent, hasPdf: true },
      { project, version: middle, hasPdf: true },
      { project, version: old, hasPdf: true },
    ]);
    expect(treeView.description).toBe("3");
    expect(hasVersionsKey()).toBe(true);
  });

  it("flags a version whose PDF is missing", async () => {
    const a = version("a", "2026-01-01T00:00:00Z");
    const b = version("b", "2026-02-01T00:00:00Z");
    const { view } = setup(true, [a, b], async () => false);
    await flush();
    expect(view.getChildren().map((row) => row.hasPdf)).toEqual([false, false]);
  });

  it("has no children below a version row", async () => {
    const { view, project } = setup(true, [version("a", "2026-01-01T00:00:00Z")]);
    await flush();
    expect(view.getChildren({ project, version: version("a", "2026-01-01T00:00:00Z"), hasPdf: true })).toEqual([]);
  });

  it("returns the item of a row from getTreeItem", async () => {
    const { view, project } = setup(true, [version("a", "2026-01-01T00:00:00Z")]);
    await flush();
    const row = view.getChildren()[0]!;
    expect(view.getTreeItem(row).label).toBe("a");
    expect(row.project).toBe(project);
  });

  it("reloads and refreshes the tree when the session changes", async () => {
    const { view, treeView, session, listVersions, sessionChanged } = setup(false);
    await flush();
    const refreshed = jest.fn();
    view.onDidChangeTreeData(refreshed);
    listVersions.mockResolvedValue([version("a", "2026-01-01T00:00:00Z")]);
    (session as { project: ReadyProject | undefined }).project = readyEntry("/code/paper") as ReadyProject;
    sessionChanged.fire(session.project);
    await flush();
    expect(treeView.description).toBe("1");
    expect(hasVersionsKey()).toBe(true);
    expect(refreshed).toHaveBeenCalled();
  });

  it("reloads when refresh is called", async () => {
    const { view, treeView, listVersions } = setup(true, [version("a", "2026-01-01T00:00:00Z")]);
    await flush();
    listVersions.mockResolvedValue([version("a", "2026-01-01T00:00:00Z"), version("b", "2026-02-01T00:00:00Z")]);
    await view.refresh();
    expect(treeView.description).toBe("2");
    expect(view.getChildren().map((row) => row.version.slug)).toEqual(["b", "a"]);
  });

  it("clears the rows when the project closes", async () => {
    const { view, treeView, session, sessionChanged } = setup(true, [version("a", "2026-01-01T00:00:00Z")]);
    await flush();
    (session as { project: ReadyProject | undefined }).project = undefined;
    sessionChanged.fire(undefined);
    await flush();
    expect(view.getChildren()).toEqual([]);
    expect(treeView.description).toBe("");
    expect(hasVersionsKey()).toBe(false);
  });
});
