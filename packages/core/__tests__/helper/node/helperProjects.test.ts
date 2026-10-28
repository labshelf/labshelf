/** Verifies the helper's open-project sessions: confinement to the library, the 8-project limit, versioned unsaved text, save, and the TeX working copy that mirrors them without writing into the library. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fakeLogger } from "../../support/fakeLogger";
import { cleanupTempDirs, listFiles, makeTempDir } from "../../support/tempDirs";
import { MAX_PROJECT_BYTES, MAX_PROJECT_FILES } from "../../../src/helper/index";
import { createHelperProjects } from "../../../src/helper/node/helperProjects";

let library: string;
let projects: ReturnType<typeof createHelperProjects>;

async function write(rel: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(library, rel)), { recursive: true });
  await fs.writeFile(path.join(library, rel), text);
}

beforeEach(async () => {
  library = await makeTempDir();
  await write("writing/thesis/main.tex", "hello world");
  await write("writing/thesis/chapters/a.tex", "chapter");
  projects = createHelperProjects({ libraryRoot: library, logger: fakeLogger() });
});
afterEach(cleanupTempDirs);

describe("createHelperProjects open", () => {
  it("lists the project's files as relative POSIX paths", async () => {
    const opened = await projects.open("thesis", "writing/thesis");
    expect([...opened.files].sort()).toEqual(["chapters/a.tex", "main.tex"]);
  });

  it("refuses a root that leaves the library with path", async () => {
    await expect(projects.open("thesis", "../outside")).rejects.toMatchObject({ code: "path" });
  });

  it("refuses a root that escapes the library through a symlink with path", async () => {
    const outside = await makeTempDir("labshelf-outside-");
    await fs.writeFile(path.join(outside, "secret.tex"), "x");
    await fs.symlink(outside, path.join(library, "writing/link"));
    await expect(projects.open("thesis", "writing/link")).rejects.toMatchObject({ code: "path" });
  });

  it("refuses a root that does not exist", async () => {
    await expect(projects.open("thesis", "writing/missing")).rejects.toBeDefined();
  });

  it("allows 8 open projects and refuses the 9th with limit", async () => {
    for (let i = 1; i <= 8; i += 1) {
      await write(`writing/p${i}/main.tex`, "x");
      await projects.open(`p${i}`, `writing/p${i}`);
    }
    await write("writing/p9/main.tex", "x");
    await expect(projects.open("p9", "writing/p9")).rejects.toMatchObject({ code: "limit" });
    await projects.close("p1");
    await expect(projects.open("p9", "writing/p9")).resolves.toBeDefined();
  });
});

describe("createHelperProjects edit and save", () => {
  beforeEach(async () => { await projects.open("thesis", "writing/thesis"); });

  it("reads the file from disk until it is edited", async () => {
    expect(await projects.textOf("thesis", "main.tex")).toBe("hello world");
  });

  it("keeps a whole-file edit as the working copy without writing to disk", async () => {
    await projects.edit("thesis", "main.tex", 1, { text: "typed" });
    expect(await projects.textOf("thesis", "main.tex")).toBe("typed");
    expect(await fs.readFile(path.join(library, "writing/thesis/main.tex"), "utf8")).toBe("hello world");
  });

  it("applies changes against the previous version", async () => {
    await projects.edit("thesis", "main.tex", 1, { text: "hello world" });
    await projects.edit("thesis", "main.tex", 2, { changes: [{ from: 0, to: 5, insert: "goodbye" }] });
    expect(await projects.textOf("thesis", "main.tex")).toBe("goodbye world");
    await projects.edit("thesis", "main.tex", 3, { changes: [{ from: 8, to: 13, insert: "moon" }] });
    expect(await projects.textOf("thesis", "main.tex")).toBe("goodbye moon");
  });

  it("answers stale when changes do not follow the helper's version, and recovers with text", async () => {
    await projects.edit("thesis", "main.tex", 1, { text: "abc" });
    await expect(projects.edit("thesis", "main.tex", 5, { changes: [{ from: 0, to: 0, insert: "x" }] })).rejects.toMatchObject({ code: "stale" });
    expect(await projects.textOf("thesis", "main.tex")).toBe("abc");
    await projects.edit("thesis", "main.tex", 5, { text: "abcx" });
    expect(await projects.textOf("thesis", "main.tex")).toBe("abcx");
  });

  it("answers stale when a change range lies outside the text", async () => {
    await projects.edit("thesis", "main.tex", 1, { text: "abc" });
    await expect(projects.edit("thesis", "main.tex", 2, { changes: [{ from: 10, to: 12, insert: "x" }] })).rejects.toMatchObject({ code: "stale" });
  });

  it("drops the unsaved text on save and reads the file from disk again", async () => {
    await projects.edit("thesis", "main.tex", 1, { text: "typed" });
    await fs.writeFile(path.join(library, "writing/thesis/main.tex"), "saved by the page");
    await projects.save("thesis", "main.tex");
    expect(await projects.textOf("thesis", "main.tex")).toBe("saved by the page");
  });

  it("refuses an unsafe path with path", async () => {
    await expect(projects.edit("thesis", "../main.tex", 1, { text: "x" })).rejects.toMatchObject({ code: "path" });
    await expect(projects.textOf("thesis", "/etc/passwd")).rejects.toMatchObject({ code: "path" });
  });

  it("refuses a file path that escapes the project through a symlink with path", async () => {
    const outside = await makeTempDir("labshelf-outside-");
    await fs.writeFile(path.join(outside, "secret.tex"), "secret");
    await fs.symlink(path.join(outside, "secret.tex"), path.join(library, "writing/thesis/leak.tex"));
    await expect(projects.textOf("thesis", "leak.tex")).rejects.toMatchObject({ code: "path" });
  });

  it("drops unsaved text when the project is closed", async () => {
    await projects.edit("thesis", "main.tex", 1, { text: "typed" });
    await projects.close("thesis");
    await projects.open("thesis", "writing/thesis");
    expect(await projects.textOf("thesis", "main.tex")).toBe("hello world");
  });
});

describe("createHelperProjects unknown project", () => {
  it.each(["edit", "save", "textOf", "close"] as const)("refuses %s with project-id", async (method) => {
    const call = {
      edit: () => projects.edit("nope", "main.tex", 1, { text: "x" }),
      save: () => projects.save("nope", "main.tex"),
      textOf: () => projects.textOf("nope", "main.tex"),
      close: () => projects.close("nope"),
    }[method];
    await expect(call()).rejects.toMatchObject({ code: "project-id" });
  });
});

describe("createHelperProjects edit file cap", () => {
  it("refuses an edit that would create an unsaved file beyond the file cap, counting disk files", async () => {
    for (let i = 0; i < MAX_PROJECT_FILES; i += 1) { await write(`writing/full/f${i}.tex`, ""); }
    await projects.open("full", "writing/full");
    await expect(projects.edit("full", "extra.tex", 1, { text: "x" })).rejects.toMatchObject({ code: "limit" });
    await expect(projects.edit("full", "f0.tex", 1, { text: "x" })).resolves.toBeUndefined();
  });
});

describe("createHelperProjects syncWorkingCopy", () => {
  it("mirrors the project into the working copy with unsaved text in place", async () => {
    const library = await makeTempDir();
    const src = path.join(await makeTempDir(), "projects/thesis/src");
    const root = path.join(library, "writing/thesis");
    await fs.mkdir(path.join(root, "chapters"), { recursive: true });
    await fs.writeFile(path.join(root, "main.tex"), "disk main");
    await fs.writeFile(path.join(root, "chapters/a.tex"), "disk a");
    const projects = createHelperProjects({ libraryRoot: library, logger: fakeLogger() });
    await projects.open("thesis", "writing/thesis");

    await projects.syncWorkingCopy("thesis", src);
    expect(await listFiles(src)).toEqual(["chapters/a.tex", "main.tex"]);

    await projects.edit("thesis", "main.tex", 1, { text: "typed main" });
    await projects.edit("thesis", "new.tex", 1, { text: "typed new" });
    await fs.rm(path.join(root, "chapters/a.tex"));
    await projects.syncWorkingCopy("thesis", src);
    expect(await fs.readFile(path.join(src, "main.tex"), "utf8")).toBe("typed main");
    expect(await fs.readFile(path.join(src, "new.tex"), "utf8")).toBe("typed new");
    expect(await listFiles(src)).toEqual(["main.tex", "new.tex"]);

    await fs.writeFile(path.join(root, "main.tex"), "saved main");
    await projects.save("thesis", "main.tex");
    await projects.syncWorkingCopy("thesis", src);
    expect(await fs.readFile(path.join(src, "main.tex"), "utf8")).toBe("saved main");
    expect(await listFiles(root)).toEqual(["main.tex"]);
    expect(await fs.readFile(path.join(root, "main.tex"), "utf8")).toBe("saved main");
  });

  it("refuses a project larger than the size limit with a limit error", async () => {
    const library = await makeTempDir();
    const src = path.join(await makeTempDir(), "projects/big/src");
    const root = path.join(library, "writing/big");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "main.tex"), "main");
    // A sparse file: it reports the size without using the disk.
    await fs.writeFile(path.join(root, "figure.png"), "");
    await fs.truncate(path.join(root, "figure.png"), MAX_PROJECT_BYTES);
    const projects = createHelperProjects({ libraryRoot: library, logger: fakeLogger() });
    await projects.open("big", "writing/big");

    await expect(projects.syncWorkingCopy("big", src)).rejects.toMatchObject({ code: "limit" });
  });

  it("counts unsaved text toward the size limit", async () => {
    const library = await makeTempDir();
    const src = path.join(await makeTempDir(), "projects/big/src");
    const root = path.join(library, "writing/big");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "figure.png"), "");
    await fs.truncate(path.join(root, "figure.png"), MAX_PROJECT_BYTES - 5);
    const projects = createHelperProjects({ libraryRoot: library, logger: fakeLogger() });
    await projects.open("big", "writing/big");
    await projects.edit("big", "main.tex", 1, { text: "0123456789" });

    await expect(projects.syncWorkingCopy("big", src)).rejects.toMatchObject({ code: "limit" });
  });

  it("reports a working copy it cannot write as an io error naming the path", async () => {
    const library = await makeTempDir();
    const blocker = path.join(await makeTempDir(), "blocker");
    await fs.writeFile(blocker, "a file where a folder is needed");
    await fs.mkdir(path.join(library, "writing/thesis"), { recursive: true });
    await fs.writeFile(path.join(library, "writing/thesis/main.tex"), "disk");
    const projects = createHelperProjects({ libraryRoot: library, logger: fakeLogger() });
    await projects.open("thesis", "writing/thesis");

    const failure = await projects.syncWorkingCopy("thesis", blocker).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "io", message: expect.stringContaining("main.tex") });
    expect((failure as Error).cause).toBeDefined();
  });
});
