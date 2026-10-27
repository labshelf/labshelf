// Tests that a project search reads only the active file or the files inside its project folder.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ILogger } from "@labshelf/core";
import { NodeLibraryFileSystem } from "@labshelf/core/node";
import { readScopeTexts, type SearchScope } from "../../../src/writing/search/replace";

const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) } as unknown as ILogger;

describe("readScopeTexts", () => {
  let root: string;
  let scope: SearchScope;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ls-search-"));
    for (const [file, text] of [["paper/main.tex", "main"], ["paper/sections/intro.tex", "intro"], ["paper/figure.png", "png"], ["other/notes.tex", "notes"]] as const) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    }
    scope = { mode: "project", folder: path.join(root, "paper"), file: path.join(root, "paper/main.tex"), paths: path, fs: new NodeLibraryFileSystem() };
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("lists the searchable files of the project and no file of a sibling folder", async () => {
    const texts = await readScopeTexts(scope, logger);
    expect(texts.map((t) => path.relative(root, t.path))).toEqual(["paper/main.tex", "paper/sections/intro.tex"]);
  });

  it("returns only the active file in file scope", async () => {
    const texts = await readScopeTexts({ ...scope, mode: "file" }, logger);
    expect(texts).toEqual([{ path: path.join(root, "paper/main.tex"), text: "main" }]);
  });

  it("returns nothing for an active file outside the project folder", async () => {
    expect(await readScopeTexts({ ...scope, mode: "file", file: path.join(root, "other/notes.tex") }, logger)).toEqual([]);
  });
});
