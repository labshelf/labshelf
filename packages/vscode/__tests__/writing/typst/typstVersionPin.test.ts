// Tests recording the Typst version after a build: the write, the once-per-project warning and the no-op when equal.
import * as vscode from "vscode";

import { TYPST_VERSION } from "@labshelf/core/typst";
import { updateProjectSettings } from "@labshelf/core/node";
import type { ReadyProject } from "../../../src/writing/mainDocument";
import { recordTypstVersion } from "../../../src/writing/typst/typstVersionPin";
import { fakeHost, fakeProjects, readyEntry } from "../../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({ ...jest.requireActual("@labshelf/core/node"), updateProjectSettings: jest.fn() }));

const warn = vscode.window.showWarningMessage as jest.Mock;
const update = updateProjectSettings as jest.Mock;

function project(folder: string, typst?: string): ReadyProject {
  return readyEntry(folder, { settings: { id: "paper", format: "typst", typst }, main: "main.typ" }) as ReadyProject;
}

function setup() {
  const host = fakeHost();
  const projects = fakeProjects();
  return { host, projects, deps: { host, projects: projects as never } };
}

beforeEach(() => { jest.clearAllMocks(); update.mockResolvedValue(undefined); });

describe("recordTypstVersion", () => {
  it("writes the version and reloads the list when none is recorded, without a warning", async () => {
    const { host, projects, deps } = setup();
    await recordTypstVersion(project("/code/a"), deps);
    expect(update).toHaveBeenCalledWith("/code/a", { typst: TYPST_VERSION }, host.session.logger);
    expect(projects.reload).toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns and rewrites when an older version was recorded", async () => {
    const { deps } = setup();
    await recordTypstVersion(project("/code/b", "0.13.1"), deps);
    expect(warn).toHaveBeenCalledWith(
      `Project "paper" was last built with Typst 0.13.1; LabShelf compiles it with Typst ${TYPST_VERSION}. Check the PDF for differences.`,
    );
    expect(update).toHaveBeenCalledWith("/code/b", { typst: TYPST_VERSION }, expect.anything());
  });

  it("warns once per project in a session", async () => {
    const { deps } = setup();
    await recordTypstVersion(project("/code/c", "0.12.0"), deps);
    await recordTypstVersion(project("/code/c", "0.12.0"), deps);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the recorded version is current", async () => {
    const { projects, deps } = setup();
    await recordTypstVersion(project("/code/d", TYPST_VERSION), deps);
    expect(update).not.toHaveBeenCalled();
    expect(projects.reload).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs a refused write and does not reload", async () => {
    const { host, projects, deps } = setup();
    update.mockRejectedValueOnce(new Error("invalid YAML"));
    await recordTypstVersion(project("/code/e"), deps);
    expect(host.session.logger.error).toHaveBeenCalledWith("writing/typst", expect.any(Error), expect.objectContaining({ folder: "/code/e" }));
    expect(projects.reload).not.toHaveBeenCalled();
  });
});
