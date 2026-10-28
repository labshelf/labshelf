// Tests the gallery's project installer (creates the project, reloads the list, opens it) and the engine probe (Typst always, each LaTeX engine only when the shared TeX resolves it).
import * as vscode from "vscode";

import { createProjectInstaller, detectEngines } from "../../../../src/writing/templates/node/register";
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

function texWith(...found: string[]) {
  return { resolve: async (engine: string) => (found.includes(engine) ? { engine, executable: "/tex/latexmk" } : "missing") } as never;
}

describe("detectEngines", () => {
  it("reports the LaTeX engines the TeX resolves", async () => {
    const { engines } = await detectEngines(texWith("pdflatex", "xelatex"));
    expect(engines.has("pdflatex")).toBe(true);
    expect(engines.has("xelatex")).toBe(true);
    expect(engines.has("lualatex")).toBe(false);
    expect(engines.has("typst")).toBe(true);
  });

  it("reports only Typst when no TeX is found", async () => {
    const { engines } = await detectEngines(texWith());
    expect([...engines]).toEqual(["typst"]);
  });
});
