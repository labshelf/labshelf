/** Verifies turning one project folder, read through the folder port, into a ready or broken entry. */
import { readProjectEntry, type ProjectFolderReader } from "../../../src/writing/project/index";
import { fakeLogger } from "../../support/fakeLogger";

function reader(files: Record<string, string>, exists = true): ProjectFolderReader {
  return {
    readOptionalText: async (name) => files[name],
    rootFileNames: async () => Object.keys(files),
    exists: async () => exists,
  };
}

const read = (folderReader: ProjectFolderReader, logger = fakeLogger()) =>
  readProjectEntry({ folder: "projects/a", location: "library", reader: folderReader, logger });

describe("readProjectEntry", () => {
  it("is ready with the main from labshelf.yaml, else the detected one", async () => {
    expect(await read(reader({ "labshelf.yaml": "id: a\nformat: typst\nmain: x.typ\n" })))
      .toMatchObject({ kind: "ready", folder: "projects/a", location: "library", main: "x.typ", settings: { id: "a" } });
    expect(await read(reader({ "labshelf.yaml": "id: a\nformat: latex\n", "p.tex": "\\documentclass{article}" })))
      .toMatchObject({ kind: "ready", main: "p.tex" });
  });

  it("is broken and warns when labshelf.yaml or the folder is missing, or the yaml does not parse", async () => {
    const logger = fakeLogger();
    expect(await read(reader({}), logger)).toMatchObject({ kind: "broken", reason: "labshelf.yaml is missing" });
    expect(await read(reader({}, false), logger)).toMatchObject({ kind: "broken", reason: "folder not found" });
    const bad = await read(reader({ "labshelf.yaml": "format: nonsense\n" }), logger);
    expect(bad.kind === "broken" && bad.reason.startsWith("labshelf.yaml: ")).toBe(true);
    expect(logger.logs.filter((entry) => entry.level === "WARN")).toHaveLength(3);
  });

  it("is broken with the error's message and logs it when the port throws", async () => {
    const logger = fakeLogger();
    const failing: ProjectFolderReader = { ...reader({}), readOptionalText: async () => { throw new Error("bridge down"); } };
    expect(await read(failing, logger)).toEqual({ kind: "broken", folder: "projects/a", location: "library", reason: "bridge down" });
    expect(logger.errors).toEqual([{ module: "project", context: { folder: "projects/a", action: "read" } }]);
  });
});
