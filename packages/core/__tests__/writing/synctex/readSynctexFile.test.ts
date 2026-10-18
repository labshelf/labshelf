/** Verifies reading a build's compressed SyncTeX file: found, missing and unreadable. */
import * as fs from "node:fs";
import * as path from "node:path";
import { gzipSync } from "node:zlib";

import { posixPathOps } from "../../../src/library/index";
import { pointFor, readSynctexFile } from "../../../src/writing/synctex/index";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

const fixture = fs.readFileSync(path.join(__dirname, "fixtures/main.synctex"));
const FILE = "/build/main.synctex.gz";

describe("readSynctexFile", () => {
  it("decompresses <base>.synctex.gz into an index", async () => {
    const memory = new MemoryLibraryFs();
    await memory.writeFile(FILE, gzipSync(fixture));
    const result = await readSynctexFile({ fs: memory, paths: posixPathOps }, "/build", "main", "/work/project");
    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(pointFor(result.index, "/work/project/chapter.tex", 2)?.page).toBe(1);
    }
  });

  it("reports a build without a SyncTeX file as missing, with the path it looked at", async () => {
    const result = await readSynctexFile({ fs: new MemoryLibraryFs(), paths: posixPathOps }, "/build", "main", "/work/project");
    expect(result).toEqual({ status: "missing", path: FILE });
  });

  it("names the file when it is not valid gzip or not SyncTeX", async () => {
    const memory = new MemoryLibraryFs();
    const context = { fs: memory, paths: posixPathOps };
    await memory.writeText(FILE, "not gzip");
    await expect(readSynctexFile(context, "/build", "main", "/work/project")).rejects.toThrow(FILE);
    await memory.writeFile(FILE, gzipSync("hello"));
    await expect(readSynctexFile(context, "/build", "main", "/work/project")).rejects.toThrow(/Not a SyncTeX file/);
  });
});
