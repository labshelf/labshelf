// Tests recording the Typst version after a build: the write, the once-per-project warning and the no-op when equal.
import * as vscode from "vscode";

import { TYPST_VERSION } from "@labshelf/core/typst";
import type { ReadyProject } from "../../../src/writing/buildRootDocument";
import { writeTypstVersion } from "../../../src/writing/typst/typstTriggers";
import { fakeHost, fakeProjects, readyEntry } from "../../support/writingFixtures";

const warn = vscode.window.showWarningMessage as jest.Mock;

function project(folder: string, typst?: string): ReadyProject {
  return readyEntry(folder, { settings: { id: "paper", format: "typst", typst }, main: "main.typ" }) as ReadyProject;
}

function setup() {
  const host = fakeHost();
  const projects = fakeProjects();
  return { host, projects, update: projects.data.updateProjectSettings, deps: { host, projects: projects as never } };
}

beforeEach(() => { jest.clearAllMocks(); });

describe("writeTypstVersion", () => {
  it("writes the version and reloads the list when none is recorded, without a warning", async () => {
    const { projects, update, deps } = setup();
    await writeTypstVersion(project("/code/a"), deps);
    expect(update).toHaveBeenCalledWith("/code/a", { typst: TYPST_VERSION });
    expect(projects.reload).toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns and rewrites when an older version was recorded", async () => {
    const { update, deps } = setup();
    await writeTypstVersion(project("/code/b", "0.13.1"), deps);
    expect(warn).toHaveBeenCalledWith(
      `Project "paper" was last built with Typst 0.13.1; LabShelf compiles it with Typst ${TYPST_VERSION}. Check the PDF for differences.`,
    );
    expect(update).toHaveBeenCalledWith("/code/b", { typst: TYPST_VERSION });
  });

  it("warns once per project in a session", async () => {
    const { deps } = setup();
    await writeTypstVersion(project("/code/c", "0.12.0"), deps);
    await writeTypstVersion(project("/code/c", "0.12.0"), deps);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the recorded version is current", async () => {
    const { projects, update, deps } = setup();
    await writeTypstVersion(project("/code/d", TYPST_VERSION), deps);
    expect(update).not.toHaveBeenCalled();
    expect(projects.reload).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs a refused write and does not reload", async () => {
    const { host, projects, update, deps } = setup();
    update.mockRejectedValueOnce(new Error("invalid YAML"));
    await writeTypstVersion(project("/code/e"), deps);
    expect(host.session.logger.error).toHaveBeenCalledWith("writing/typst", expect.any(Error), expect.objectContaining({ folder: "/code/e" }));
    expect(projects.reload).not.toHaveBeenCalled();
  });
});
