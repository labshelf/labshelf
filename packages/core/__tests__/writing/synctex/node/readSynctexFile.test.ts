// Tests reading a build's compressed SyncTeX file: found, missing and unreadable.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gzipSync } from "node:zlib";

import { pointFor } from "../../../../src/writing/synctex";
import { readSynctexFile } from "../../../../src/writing/synctex/node";

const fixture = fs.readFileSync(path.join(__dirname, "../fixtures/main.synctex"));
let outDir: string;

beforeEach(() => { outDir = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-synctex-")); });
afterEach(() => fs.rmSync(outDir, { recursive: true, force: true }));

describe("readSynctexFile", () => {
  it("decompresses <base>.synctex.gz into an index", async () => {
    fs.writeFileSync(path.join(outDir, "main.synctex.gz"), gzipSync(fixture));
    const result = await readSynctexFile(outDir, "main", "/work/project");
    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(pointFor(result.index, "/work/project/chapter.tex", 2)?.page).toBe(1);
    }
  });

  it("reports a build without a SyncTeX file as missing, with the path it looked at", async () => {
    expect(await readSynctexFile(outDir, "main", "/work/project")).toEqual({ status: "missing", path: path.join(outDir, "main.synctex.gz") });
  });

  it("names the file when it is not valid gzip or not SyncTeX", async () => {
    fs.writeFileSync(path.join(outDir, "main.synctex.gz"), "not gzip");
    await expect(readSynctexFile(outDir, "main", "/work/project")).rejects.toThrow(path.join(outDir, "main.synctex.gz"));
    fs.writeFileSync(path.join(outDir, "main.synctex.gz"), gzipSync("hello"));
    await expect(readSynctexFile(outDir, "main", "/work/project")).rejects.toThrow(/Not a SyncTeX file/);
  });
});
