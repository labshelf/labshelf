// Pins that the browser's All projects library lists the library folder's projects and opens one in the page's project session.
import { blankTemplate, type ILogger } from "@labshelf/core";
import { memoryLibraryFs } from "../../support/memoryLibraryFs";
import { createBrowserProjectData, createBrowserProjectLibrary } from "../../../src/writing/project";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;

async function libraryWithOneProject() {
  const fs = memoryLibraryFs();
  const created = await createBrowserProjectData({ fs, logger }).createProjectFromTemplate("", { title: "Deep nets", ...blankTemplate("typst", "Deep nets") });
  const workspace = { openTab: jest.fn() };
  const session = { openProject: jest.fn(async () => true), current: jest.fn(() => undefined) };
  const library = createBrowserProjectLibrary({
    fs, logger, workspace, session, pdfjs: { load: jest.fn(), getDocument: jest.fn() }, listPapers: async () => [], askBlank: async () => undefined,
  });
  return { created, session, library };
}

describe("createBrowserProjectLibrary", () => {
  it("lists the projects of the library folder", async () => {
    const { created, library } = await libraryWithOneProject();
    await new Promise((resolve) => library.onDidChange(() => resolve(undefined)));
    const rows = await library.list();
    expect(rows.map((row) => row.title)).toEqual(["deep-nets"]);
    expect(created.kind).toBe("ready");
  });

  it("opens a project through the session", async () => {
    const { created, session, library } = await libraryWithOneProject();
    await new Promise((resolve) => library.onDidChange(() => resolve(undefined)));
    const [row] = await library.list();
    await library.open(row!.id);
    expect(session.openProject).toHaveBeenCalledWith(expect.objectContaining({ folder: created.folder }));
  });
});
