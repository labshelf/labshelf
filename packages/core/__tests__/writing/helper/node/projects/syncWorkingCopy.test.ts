/** Verifies that syncWorkingCopy copies changed files, lays unsaved text over them, deletes vanished files and never writes into the library. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fakeLogger } from "../../../../support/fakeLogger";
import { cleanupTempDirs, listFiles, makeTempDir } from "../../../../support/tempDirs";
import { MAX_PROJECT_BYTES } from "../../../../../src/writing/helper/index";
import { createHelperProjects } from "../../../../../src/writing/helper/node/projects/index";

afterEach(cleanupTempDirs);

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
