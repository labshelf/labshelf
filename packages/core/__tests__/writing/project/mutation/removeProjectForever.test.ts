/** Verifies that deleting a project forever removes folders under the projects root only and keeps every other folder's files. */
import { createBlankTemplate, createProjectFromTemplate, deleteProjectForever } from "@labshelf/core";

import { LIB, filesUnder, memoryCatalog, writeTree } from "../../../support/memoryProjectCatalog";

describe("removeProjectForever", () => {
  it("removes a library project folder and keeps the projects folder", async () => {
    const context = memoryCatalog();
    const entry = await createProjectFromTemplate(context, LIB, { title: "Notes", ...createBlankTemplate("latex", "Notes") });
    await deleteProjectForever(context, LIB, entry.folder);
    expect(filesUnder(context.fs, entry.folder)).toEqual([]);
    expect(await context.fs.stat(entry.folder)).toBeUndefined();
    expect(await context.fs.stat(`${LIB}/projects`)).toBeDefined();
  });

  it("unregisters an external folder and leaves its files", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, "/outside", { "main.tex": "hello" });
    await context.registry.register(LIB, "/outside");
    await deleteProjectForever(context, LIB, "/outside");
    expect(filesUnder(context.fs, "/outside")).toEqual(["main.tex"]);
    expect(await context.registry.folders(LIB)).toEqual([]);
  });

  it("refuses the projects folder itself and removes nothing", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, `${LIB}/projects/a`, { "main.tex": "x" });
    await expect(deleteProjectForever(context, LIB, `${LIB}/projects`)).rejects.toThrow(/projects folder/);
    expect(filesUnder(context.fs, `${LIB}/projects`)).toEqual(["a/main.tex"]);
  });

  it("treats a path that climbs out of the projects folder as outside and removes nothing", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, `${LIB}/x`, { "keep.txt": "x" });
    await writeTree(context.fs, `${LIB}/projects/a`, { "main.tex": "x" });
    await deleteProjectForever(context, LIB, `${LIB}/projects/../x`);
    expect(filesUnder(context.fs, `${LIB}/x`)).toEqual(["keep.txt"]);
    expect(filesUnder(context.fs, `${LIB}/projects`)).toEqual(["a/main.tex"]);
  });

  it("only unregisters the library root and keeps its files", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, LIB, { "library.json": "{}" });
    await writeTree(context.fs, `${LIB}/projects/a`, { "main.tex": "x" });
    await context.registry.register(LIB, LIB);
    await deleteProjectForever(context, LIB, LIB);
    expect(filesUnder(context.fs, LIB)).toEqual(["library.json", "projects/a/main.tex"]);
    expect(await context.registry.folders(LIB)).toEqual([]);
  });

  it("logs the failure and names the folder when the removal fails", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, `${LIB}/projects/a`, { "main.tex": "x" });
    context.fs.removeTree = async () => { throw new Error("busy"); };
    await expect(deleteProjectForever(context, LIB, `${LIB}/projects/a`)).rejects.toThrow(/projects\/a failed/);
    expect(context.logger.errors).toHaveLength(1);
  });
});
