// Tests the All projects adapter: where each project is listed and what trashing writes to labshelf.yaml.
import { createProjectLibrary } from "../../../src/writing/allProjects/projectLibrary";
import { fakeHost, fakeProjects, readyEntry } from "../../support/writingFixtures";

function setup() {
  const entries = [
    readyEntry("/lib/projects/a"),
    readyEntry("/lib/projects/b", { settings: { id: "b", format: "typst", archived: true, title: "Bee" } }),
    readyEntry("/lib/projects/c", { settings: { id: "c", format: "latex", trashed: "2026-01-01T00:00:00.000Z" } }),
  ];
  const projects = fakeProjects(entries);
  const source = {
    rows: jest.fn(async () => [{ id: "/lib/projects/a", count: "3" }]),
    list: () => entries,
    find: (id: string) => entries.find((entry) => entry.folder === id),
    update: jest.fn(async () => {}),
    onDidChange: jest.fn(() => ({ dispose() {} })),
  };
  const library = createProjectLibrary({ host: fakeHost(), projects: projects as never, session: { project: undefined }, source: source as never });
  return { library, source, projects };
}

describe("createProjectLibrary", () => {
  it("lists each project in its place with its title and open items", async () => {
    const rows = await setup().library.list();
    expect(rows.map((row) => [row.title, row.place, row.openItems])).toEqual([["a", "projects", 3], ["Bee", "archived", undefined], ["c", "trash", undefined]]);
  });

  it("writes the trash time to the project's yaml and reloads the list", async () => {
    const { library, source, projects } = setup();
    await library.setTrashed("/lib/projects/a", true);
    expect(source.update).toHaveBeenCalledWith("/lib/projects/a", { trashed: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) });
    expect(projects.reload).toHaveBeenCalled();
  });

  it("rejects an id that is not in the library", async () => {
    await expect(setup().library.setTrashed("/nope", true)).rejects.toThrow("project /nope is not in the library");
  });
});
