/** Verifies the helper's open-project sessions: confinement to the library, the 8-project limit, versioned unsaved text and save. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";
import { MAX_PROJECT_FILES } from "../../../../src/helper/index";
import { createHelperProjects } from "../../../../src/helper/node/projects/index";

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
