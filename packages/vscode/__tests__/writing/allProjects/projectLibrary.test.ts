// Tests how the All projects library is composed for VS Code: open-project detection, merged change listeners and the offered new kinds.
import { createProjectLibrary } from "../../../src/writing/allProjects/projectLibrary";
import { fakeHost, fakeLogger, fakeProjects, readyEntry } from "../../support/writingFixtures";

function setup(openFolder?: string) {
  const entry = readyEntry("/lib/projects/a", { settings: { id: "a", format: "latex" } });
  const projects = fakeProjects([entry]);
  const disposers = [jest.fn(), jest.fn(), jest.fn()];
  const event = (index: number) => jest.fn(() => ({ dispose: disposers[index] }));
  const library = createProjectLibrary({
    host: fakeHost(), projects: projects as never, session: { project: openFolder ? { folder: openFolder } : undefined } as never,
    source: { list: () => [entry], find: (id: string) => (id === entry.folder ? entry : undefined), update: jest.fn(async () => {}), onDidChange: event(0) } as never,
    outcomes: { last: () => undefined, onDidChange: event(1) } as never,
    builds: { builtRoots: () => [], problemsOf: () => undefined, stateOf: () => undefined },
    onDidChangeRootBuild: event(2) as never,
    listPapers: async () => [], logger: fakeLogger(), pdfjs: {} as never, recompile: jest.fn(async () => undefined),
  });
  return { library, projects, disposers, entry };
}

describe("createProjectLibrary", () => {
  it("stops listening to the project list, the outcomes and the root builds together", () => {
    const { library, disposers } = setup();
    const stop = library.onDidChange(() => {});
    disposers.forEach((dispose) => expect(dispose).not.toHaveBeenCalled());
    stop();
    disposers.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
  });

  it("refuses to delete the project open in the window", async () => {
    const { library, projects, entry } = setup("/lib/projects/a");
    await expect(library.deleteForever(entry.folder)).rejects.toThrow("close the project before deleting it");
    expect(projects.data.deleteProjectForever).not.toHaveBeenCalled();
  });

  it("deletes a project that is not open", async () => {
    const { library, projects, entry } = setup("/lib/projects/other");
    await library.deleteForever(entry.folder);
    expect(projects.data.deleteProjectForever).toHaveBeenCalledWith("/lib", entry.folder);
    expect(projects.reload).toHaveBeenCalled();
  });

  it("offers VS Code's open label and at least a blank project", () => {
    const { library } = setup();
    expect(library.openLabel()).toBe("Open in VS Code");
    expect(library.newKinds()).toContain("blank");
  });
});
