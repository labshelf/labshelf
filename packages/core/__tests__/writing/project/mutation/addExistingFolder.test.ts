/** Verifies registering a folder outside the library: only labshelf.yaml is written, bad folders are refused before registering. */
import { addExistingFolder, createBlankTemplate, createProjectFromTemplate, listProjects } from "@labshelf/core";

import { LIB, filesUnder, memoryCatalog, readText, writeTree } from "../../../support/memoryProjectCatalog";

describe("addExistingFolder", () => {
  it("writes labshelf.yaml only, registers the folder and lists it as external", async () => {
    const context = memoryCatalog();
    const folder = "/outside/My Paper";
    await writeTree(context.fs, folder, { "main.tex": "\\documentclass{article}", ".git/HEAD": "ref" });
    const before = filesUnder(context.fs, folder);

    const entry = await addExistingFolder(context, LIB, { folder, format: "latex" });

    expect(entry).toMatchObject({ kind: "ready", folder, location: "external", main: "main.tex", settings: { id: "my-paper" } });
    expect(filesUnder(context.fs, folder)).toEqual([...before, "labshelf.yaml"].sort());
    expect(readText(context.fs, `${folder}/main.tex`)).toBe("\\documentclass{article}");
    expect(await context.registry.folders(LIB)).toEqual([folder]);
    const listed = await listProjects(context, LIB, await context.registry.folders(LIB));
    expect(listed.map((e) => [e.folder, e.location])).toEqual([[folder, "external"]]);
  });

  it("leaves an existing valid labshelf.yaml byte-identical", async () => {
    const context = memoryCatalog();
    const text = "# keep\nid: mine\nformat: typst\nextra: 1\n";
    await writeTree(context.fs, "/outside/p", { "labshelf.yaml": text });
    await addExistingFolder(context, LIB, { folder: "/outside/p", format: "latex" });
    expect(readText(context.fs, "/outside/p/labshelf.yaml")).toBe(text);
  });

  it("rejects an invalid existing labshelf.yaml without registering", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, "/outside/p", { "labshelf.yaml": "id: a\nformat: nope\n" });
    await expect(addExistingFolder(context, LIB, { folder: "/outside/p", format: "latex" })).rejects.toThrow(/format must be/);
    expect(await context.registry.folders(LIB)).toEqual([]);
  });

  it("rejects a folder inside the library root without registering or writing", async () => {
    const context = memoryCatalog();
    const inside = `${LIB}/projects/x`;
    await writeTree(context.fs, inside, { "main.tex": "x" });
    await expect(addExistingFolder(context, LIB, { folder: inside, format: "latex" })).rejects.toThrow(/inside the library/);
    expect(await context.registry.folders(LIB)).toEqual([]);
    expect(filesUnder(context.fs, inside)).toEqual(["main.tex"]);
  });

  it("rejects an existing id that clashes with another project", async () => {
    const context = memoryCatalog();
    await createProjectFromTemplate(context, LIB, { title: "Thesis", ...createBlankTemplate("latex", "Thesis") });
    await writeTree(context.fs, "/outside/p", { "labshelf.yaml": "id: Thesis\nformat: latex\n" });
    await expect(addExistingFolder(context, LIB, { folder: "/outside/p", format: "latex" })).rejects.toThrow(/already used/);
    expect(await context.registry.folders(LIB)).toEqual([]);
  });

  it("gives a folder without labshelf.yaml a fresh id when its name clashes", async () => {
    const context = memoryCatalog();
    await createProjectFromTemplate(context, LIB, { title: "paper", ...createBlankTemplate("latex", "paper") });
    await writeTree(context.fs, "/outside/paper", { "main.tex": "x" });
    const entry = await addExistingFolder(context, LIB, { folder: "/outside/paper", format: "latex" });
    expect(entry.kind === "ready" && entry.settings.id).toBe("papera");
  });
});
