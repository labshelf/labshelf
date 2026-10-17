import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ILogger } from "@labshelf/core";

import { runConflicts } from "../../../src/cli/setup/conflictsCommand";
import type { Output } from "../../../src/cli/usage";
import { makeTempDir } from "../../fixtures/library";

const logger: ILogger = { log: async () => undefined, error: async () => undefined } as unknown as ILogger;

describe("runConflicts", () => {
  let root: string;
  let lines: string[];
  let io: Output;
  beforeEach(async () => {
    root = await makeTempDir();
    const dir = path.join(root, "papers", "smith2020");
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(path.join(root, ".research"));
    await fs.writeFile(path.join(dir, "metadata.yaml"), "title: A\n");
    await fs.writeFile(path.join(dir, "notes.md"), "mine");
    await fs.writeFile(path.join(dir, "notes.sync-conflict-20240101-101010-ABCDEFG.md"), "other");
    lines = [];
    io = { out: (t) => lines.push(t), err: (t) => lines.push(t), columns: 80 };
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("only lists the copies without a prompt", async () => {
    expect(await runConflicts(root, io, undefined, logger)).toBe(0);
    expect(lines.join("\n")).toContain(path.join("papers", "smith2020", "notes.sync-conflict-20240101-101010-ABCDEFG.md"));
    expect(lines.join("\n")).toContain("smith2020");
    expect(lines.join("\n")).toContain("syncthing");
  });

  it("applies the answer: o keeps the other copy", async () => {
    const answers = ["x", "o"];
    const asked: string[] = [];
    await runConflicts(root, io, async (q) => { asked.push(q); return answers.shift(); }, logger);
    expect(asked[0]).toContain("[m]ine / [o]ther / [b]oth / [s]kip");
    expect(await fs.readFile(path.join(root, "papers", "smith2020", "notes.md"), "utf8")).toBe("other");
  });

  it("leaves the copy when skipped or when input ends", async () => {
    await runConflicts(root, io, async () => "s", logger);
    await runConflicts(root, io, async () => undefined, logger);
    expect(await fs.readdir(path.join(root, "papers", "smith2020"))).toHaveLength(3);
  });

  it("does not offer both for metadata.yaml", async () => {
    const dir = path.join(root, "papers", "smith2020");
    await fs.writeFile(path.join(dir, "metadata.sync-conflict-20240101-101010-ABCDEFG.yaml"), "title: B\n");
    const asked: string[] = [];
    await runConflicts(root, io, async (q) => { asked.push(q); return "s"; }, logger);
    expect(asked.filter((q) => q.includes("[b]oth"))).toHaveLength(1);
    expect(asked.filter((q) => !q.includes("[b]oth"))).toHaveLength(1);
  });
});
