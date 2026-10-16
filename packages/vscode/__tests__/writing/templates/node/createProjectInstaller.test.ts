// Tests the gallery's project installer: it creates the project, reloads the list and opens the project.
import * as vscode from "vscode";

import { createProjectInstaller } from "../../../../src/writing/templates/node/registerTemplates";
import { fakeHost, fakeProjects, readyEntry } from "../../../support/writingFixtures";

const template = { id: "ieee", format: "latex", main: "main.tex" } as never;
const files = [{ path: "main.tex", bytes: new Uint8Array([1]) }];

beforeEach(() => jest.clearAllMocks());

describe("createProjectInstaller", () => {
  it("installs the files, reloads the projects and opens the new project", async () => {
    const host = fakeHost();
    const projects = fakeProjects();
    const entry = readyEntry("/lib/projects/survey");
    projects.data.createProjectFromTemplate.mockResolvedValue(entry);

    await createProjectInstaller({ host, projects: projects as never })("Survey", template, files);

    expect(projects.data.createProjectFromTemplate).toHaveBeenCalledWith("/lib", { title: "Survey", template, files });
    expect(projects.reload).toHaveBeenCalled();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("labshelf.writing.openProject", entry);
  });

  it("fails and creates nothing when no library is chosen", async () => {
    const host = fakeHost();
    (host.require as jest.Mock).mockResolvedValue(undefined);
    const projects = fakeProjects();

    await expect(createProjectInstaller({ host, projects: projects as never })("Survey", template, files)).rejects.toThrow("Choose a library");
    expect(projects.data.createProjectFromTemplate).not.toHaveBeenCalled();
  });
});
