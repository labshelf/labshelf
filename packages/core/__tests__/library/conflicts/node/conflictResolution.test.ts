// Verifies conflict choices preserve files and record project writes before replacement.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ConflictCopy } from "../../../../src/library/conflicts/index";
import { resolveConflictCopy } from "../../../../src/library/conflicts/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, listFiles, makeTempDir } from "../../../support/tempDirs";

afterEach(async () => {
  jest.restoreAllMocks();
  await cleanupTempDirs();
});

async function paperWith(original: string, copyName: string): Promise<{ dir: string; copy: ConflictCopy }> {
  const dir = await makeTempDir();
  await fs.writeFile(path.join(dir, original), "mine");
  await fs.writeFile(path.join(dir, copyName), "other");
  return { dir, copy: { owner: { kind: "paper", id: "p" }, original: path.join(dir, original), copy: path.join(dir, copyName), tool: "syncthing" } };
}

const PDF_COPY = "paper.sync-conflict-20240301-123456-ABCDEFG.pdf";

describe("resolveConflictCopy", () => {
  it("keepMine deletes the copy and keeps the original", async () => {
    const { dir, copy } = await paperWith("paper.pdf", PDF_COPY);
    const logger = fakeLogger();
    await resolveConflictCopy(copy, "keepMine", logger);
    expect(await listFiles(dir)).toEqual(["paper.pdf"]);
    expect(await fs.readFile(copy.original, "utf8")).toBe("mine");
    expect(logger.logs.some((l) => l.level === "INFO")).toBe(true);
  });

  it("keepOther replaces the original with the copy", async () => {
    const { dir, copy } = await paperWith("paper.pdf", PDF_COPY);
    await resolveConflictCopy(copy, "keepOther", fakeLogger());
    expect(await listFiles(dir)).toEqual(["paper.pdf"]);
    expect(await fs.readFile(copy.original, "utf8")).toBe("other");
  });

  it("keepBoth renames the copy to the first free '(copy N)' name", async () => {
    const { dir, copy } = await paperWith("paper.pdf", PDF_COPY);
    await fs.writeFile(path.join(dir, "paper (copy 1).pdf"), "earlier");
    await resolveConflictCopy(copy, "keepBoth", fakeLogger());
    expect(await listFiles(dir)).toEqual(["paper (copy 1).pdf", "paper (copy 2).pdf", "paper.pdf"]);
    expect(await fs.readFile(path.join(dir, "paper (copy 2).pdf"), "utf8")).toBe("other");
    expect(await fs.readFile(copy.original, "utf8")).toBe("mine");
  });

  it("keepBoth names a copy of a file without extension", async () => {
    const { dir, copy } = await paperWith("notes", "notes.sync-conflict-20240301-123456-ABCDEFG");
    await resolveConflictCopy(copy, "keepBoth", fakeLogger());
    expect(await listFiles(dir)).toEqual(["notes", "notes (copy 1)"]);
  });

  it("refuses keepBoth for metadata.yaml and changes nothing", async () => {
    const { dir, copy } = await paperWith("metadata.yaml", "metadata.sync-conflict-20240301-123456-ABCDEFG.yaml");
    await expect(resolveConflictCopy(copy, "keepBoth", fakeLogger())).rejects.toThrow(/metadata\.yaml/);
    expect((await listFiles(dir)).length).toBe(2);
  });

  it("keepBoth never overwrites a '(copy N)' file that appears after the free name was chosen", async () => {
    const { dir, copy } = await paperWith("paper.pdf", PDF_COPY);
    const appeared = path.join(dir, "paper (copy 1).pdf");
    await fs.writeFile(appeared, "appeared");
    const realStat = fs.stat.bind(fs);
    jest.spyOn(fs, "stat").mockImplementation(((file: string) =>
      file === appeared ? Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" })) : realStat(file)) as typeof fs.stat);

    await resolveConflictCopy(copy, "keepBoth", fakeLogger());
    expect(await fs.readFile(appeared, "utf8")).toBe("appeared");
    expect(await fs.readFile(path.join(dir, "paper (copy 2).pdf"), "utf8")).toBe("other");
    expect(await listFiles(dir)).toEqual(["paper (copy 1).pdf", "paper (copy 2).pdf", "paper.pdf"]);
  });

  it.each([
    ["a copy whose name is not a conflict copy of the original", "other.sync-conflict-20240301-123456-ABCDEFG.pdf", ""],
    ["a copy that is not a conflict name at all", "paper (1).pdf", ""],
    ["a copy in another folder", PDF_COPY, "sub"],
  ])("rejects %s and changes nothing", async (_label, copyName, subdir) => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, subdir), { recursive: true });
    await fs.writeFile(path.join(dir, "paper.pdf"), "mine");
    await fs.writeFile(path.join(dir, subdir, copyName), "other");
    const conflict: ConflictCopy = { owner: { kind: "paper", id: "p" }, original: path.join(dir, "paper.pdf"), copy: path.join(dir, subdir, copyName), tool: "syncthing" };

    for (const resolution of ["keepMine", "keepOther", "keepBoth"] as const) {
      await expect(resolveConflictCopy(conflict, resolution, fakeLogger())).rejects.toThrow(/not a conflict copy/);
    }
    expect(await fs.readFile(conflict.original, "utf8")).toBe("mine");
    expect(await fs.readFile(conflict.copy, "utf8")).toBe("other");
  });
});

it('records project keepOther before replacement and commits after it', async () => {
  const { copy } = await paperWith('main.tex', 'main.tex.conflict1');
  const beforeSave = jest.fn(async () => { expect(await fs.readFile(copy.original, 'utf8')).toBe('mine'); });
  const afterSave = jest.fn(async () => { expect(await fs.readFile(copy.original, 'utf8')).toBe('other'); });
  await resolveConflictCopy(copy, 'keepOther', fakeLogger(), { beforeSave, afterSave });
  expect(beforeSave).toHaveBeenCalledWith(copy.original, 'other');
  expect(afterSave).toHaveBeenCalledWith(copy.original, 'other');
});

it('keeps the original intact when recording a project replacement fails', async () => {
  const { copy } = await paperWith('main.tex', 'main.tex.conflict1');
  const afterSave = jest.fn(async () => {});
  await expect(resolveConflictCopy(copy, 'keepOther', fakeLogger(), {
    beforeSave: async () => { throw new Error('record failed'); }, afterSave,
  })).rejects.toThrow('record failed');
  expect(await fs.readFile(copy.original, 'utf8')).toBe('mine');
  expect(await fs.readFile(copy.copy, 'utf8')).toBe('other');
  expect(afterSave).not.toHaveBeenCalled();
});

it('records keepBoth before copying without replacing occupied destinations', async () => {
  const { dir, copy } = await paperWith('main.tex', 'main.tex.conflict1');
  const afterSave = jest.fn(async (file: string) => { expect(await fs.readFile(file, 'utf8')).toBe('other'); });
  const beforeSave = jest.fn(async (file: string) => {
    await expect(fs.readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  await resolveConflictCopy(copy, 'keepBoth', fakeLogger(), { beforeSave, afterSave });
  const destination = path.join(dir, 'main (copy 1).tex');
  expect(beforeSave).toHaveBeenCalledWith(destination, 'other');
  expect(afterSave).toHaveBeenCalledWith(destination, 'other');
});

it('keeps invalid UTF-8 bytes outside project text history', async () => {
  const { copy } = await paperWith('main.tex', 'main.tex.conflict1');
  const bytes = Buffer.from([0xff, 0xfe, 0x61]);
  await fs.writeFile(copy.copy, bytes);
  const beforeSave = jest.fn(async () => {});
  const afterSave = jest.fn(async () => {});
  await resolveConflictCopy(copy, 'keepOther', fakeLogger(), { beforeSave, afterSave });
  expect(await fs.readFile(copy.original)).toEqual(bytes);
  expect(beforeSave).not.toHaveBeenCalled();
  expect(afterSave).not.toHaveBeenCalled();
});
