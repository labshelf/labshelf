// Tests the All projects actions on any project: build, preview, open log, create file and set target.
import { libraryHarness, readyEntry } from "../../../support/projectLibraryHarness";

const FOLDER = "/lib/projects/a";

function setup(hasMain = true) {
  return libraryHarness([readyEntry(FOLDER, hasMain ? {} : { main: undefined })]);
}

describe("build", () => {
  it("builds the main root of the given project", async () => {
    const { library, host } = setup();
    await library.build(FOLDER);
    expect(host.build).toHaveBeenCalledWith(expect.objectContaining({ folder: FOLDER }), "main.tex");
  });

  it("refuses a project without a main file, naming the folder", async () => {
    const { library, host } = setup(false);
    await expect(library.build(FOLDER)).rejects.toThrow(FOLDER);
    expect(host.build).not.toHaveBeenCalled();
  });
});

describe("preview", () => {
  it("hands the project to the host's preview", async () => {
    const { library, host } = setup();
    await library.preview(FOLDER);
    expect(host.preview).toHaveBeenCalledWith(expect.objectContaining({ folder: FOLDER }));
  });
});

describe("openLog", () => {
  it("opens the raw log of the main root", async () => {
    const { library, host, locate } = setup();
    locate.rawLog.mockResolvedValue("/cache/a/main.log");
    await library.openLog(FOLDER);
    expect(locate.rawLog).toHaveBeenCalledWith(expect.objectContaining({ folder: FOLDER }), "main.tex");
    expect(host.openLog).toHaveBeenCalledWith("/cache/a/main.log");
  });

  it("fails with 'No build log yet' when the build left none", async () => {
    const { library, host } = setup();
    await expect(library.openLog(FOLDER)).rejects.toThrow(`No build log yet for ${FOLDER}`);
    expect(host.openLog).not.toHaveBeenCalled();
  });
});

describe("createFile", () => {
  it("creates the parent folders and an empty file, then opens it", async () => {
    const { library, fs, host } = setup();
    await library.createFile(FOLDER, "chapters/intro.tex");
    expect(await fs.readText(`${FOLDER}/chapters/intro.tex`)).toBe("");
    expect(host.openFile).toHaveBeenCalledWith(expect.objectContaining({ folder: FOLDER }), "chapters/intro.tex");
  });

  it("refuses an existing name and leaves its content", async () => {
    const { library, fs, host } = setup();
    await fs.writeText(`${FOLDER}/notes.md`, "keep me");
    await expect(library.createFile(FOLDER, "notes.md")).rejects.toThrow(`notes.md already exists in ${FOLDER}`);
    expect(await fs.readText(`${FOLDER}/notes.md`)).toBe("keep me");
    expect(host.openFile).not.toHaveBeenCalled();
  });

  it.each(["../outside.tex", "a/../../outside.tex", "/etc/passwd", "..", ""])("refuses %j, which resolves outside the folder", async (file) => {
    const { library, fs, host } = setup();
    await expect(library.createFile(FOLDER, file)).rejects.toThrow(FOLDER);
    expect(fs.fileList()).toEqual([]);
    expect(host.openFile).not.toHaveBeenCalled();
  });
});

describe("setTarget", () => {
  it("writes the target to the project's settings and reloads the list", async () => {
    const { library, projects } = setup();
    await library.setTarget(FOLDER, { venue: "NeurIPS" });
    expect(projects.update).toHaveBeenCalledWith(FOLDER, { target: { venue: "NeurIPS" } });
    expect(projects.reload).toHaveBeenCalled();
  });

  it("passes null through so the target key is removed", async () => {
    const { library, projects } = setup();
    await library.setTarget(FOLDER, null);
    expect(projects.update).toHaveBeenCalledWith(FOLDER, { target: null });
  });
});
