/** Verifies reading a project folder into an entry and rewriting its settings. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { readProject, updateProjectSettings } from "../../../../src/writing/project/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

async function folderWith(files: Record<string, string>): Promise<string> {
  const dir = await makeTempDir();
  for (const [name, text] of Object.entries(files)) { await fs.writeFile(path.join(dir, name), text); }
  return dir;
}

describe("readProject", () => {
  it("is ready with the main named in labshelf.yaml", async () => {
    const dir = await folderWith({ "labshelf.yaml": "id: a\nformat: latex\nmain: x.tex\n" });
    const entry = await readProject(dir, "library", fakeLogger());
    expect(entry).toMatchObject({ kind: "ready", folder: dir, location: "library", main: "x.tex", settings: { id: "a" } });
  });

  it("is ready with a detected main when the yaml names none", async () => {
    const dir = await folderWith({
      "labshelf.yaml": "id: a\nformat: latex\n", "chapter.tex": "text", "paper.tex": "\\documentclass{article}",
    });
    const entry = await readProject(dir, "external", fakeLogger());
    expect(entry).toMatchObject({ kind: "ready", location: "external", main: "paper.tex" });
  });

  it("is ready with an undefined main when nothing is detected", async () => {
    const dir = await folderWith({ "labshelf.yaml": "id: a\nformat: typst\n" });
    const entry = await readProject(dir, "library", fakeLogger());
    expect(entry.kind === "ready" && entry.main).toBeUndefined();
  });

  it("is broken when labshelf.yaml is missing", async () => {
    const dir = await folderWith({});
    const logger = fakeLogger();
    expect(await readProject(dir, "library", logger)).toEqual({
      kind: "broken", folder: dir, location: "library", reason: "labshelf.yaml is missing",
    });
    expect(logger.logs.map((entry) => entry.level)).toEqual(["WARN"]);
  });

  it("is broken when the folder does not exist", async () => {
    const dir = path.join(await makeTempDir(), "gone");
    const entry = await readProject(dir, "external", fakeLogger());
    expect(entry).toMatchObject({ kind: "broken", reason: "folder not found" });
  });

  it("is broken with the offending key when the yaml is invalid", async () => {
    const dir = await folderWith({ "labshelf.yaml": "id: a\nformat: word\n" });
    const entry = await readProject(dir, "library", fakeLogger());
    expect(entry.kind).toBe("broken");
    expect(entry.kind === "broken" && entry.reason).toMatch(/^labshelf\.yaml: format must be/);
  });
});

describe("updateProjectSettings", () => {
  it("patches main and keeps comments", async () => {
    const dir = await folderWith({ "labshelf.yaml": "# mine\nid: a\nformat: latex\n" });
    await updateProjectSettings(dir, { main: "paper.tex" }, fakeLogger());
    expect(await fs.readFile(path.join(dir, "labshelf.yaml"), "utf8")).toBe("# mine\nid: a\nformat: latex\nmain: paper.tex\n");
  });

  it("rejects and leaves the file unchanged when the yaml is invalid", async () => {
    const text = "id: a\nformat: nope\n";
    const dir = await folderWith({ "labshelf.yaml": text });
    await expect(updateProjectSettings(dir, { main: "x.tex" }, fakeLogger())).rejects.toThrow(/format must be/);
    expect(await fs.readFile(path.join(dir, "labshelf.yaml"), "utf8")).toBe(text);
  });
});
