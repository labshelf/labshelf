import type { ILogger } from "@labshelf/core";
import { IdbFileSystem } from "../../../src/storage/idb";
import { MoveToFolderError, countPapers, moveToFolder } from "../../../src/storage/library";
import { clearFakeDb, fakeFiles, putFile, textAt } from "../../support/fakeIdb";
import { MemoryFolderFs } from "./memoryFolderFs";

jest.mock("webextension-polyfill", () => ({}));
jest.mock("idb", () => ({ openDB: async () => require("../../support/fakeIdb").fakeDb }));

const logger: ILogger = { log: async () => undefined, error: jest.fn(async () => undefined) };
const from = new IdbFileSystem();
let to: MemoryFolderFs;

beforeEach(() => {
  clearFakeDb();
  to = new MemoryFolderFs();
  putFile("papers/topic/a/metadata.yaml", "title: A");
  putFile("papers/topic/a/paper.pdf", "PDF-A");
  putFile(".research/papers/a/data.json", "{\"a\":1}");
  putFile("papers/zeta/b/metadata.yaml", "title: B");
  putFile(".research/papers/b/data.json", "{\"b\":1}");
});

it("counts the papers in a library", async () => {
  expect(await countPapers(from)).toBe(2);
});

it("copies, verifies and clears every paper", async () => {
  const result = await moveToFolder({ from, to, logger });

  expect(result).toEqual({ moved: ["a", "b"], skipped: [] });
  expect(to.text("papers/topic/a/paper.pdf")).toBe("PDF-A");
  expect(to.text(".research/papers/a/data.json")).toBe("{\"a\":1}");
  expect(to.text("papers/zeta/b/metadata.yaml")).toBe("title: B");
  expect([...fakeFiles.keys()].filter((path) => !path.endsWith(".keep"))).toEqual([]);
});

it("skips a paper whose id the folder already holds and keeps it in browser storage", async () => {
  to.put("papers/elsewhere/a/metadata.yaml", "title: folder copy");

  const result = await moveToFolder({ from, to, logger });

  expect(result).toEqual({ moved: ["b"], skipped: ["a"] });
  expect(to.text("papers/topic/a/paper.pdf")).toBeUndefined();
  expect(textAt("papers/topic/a/paper.pdf")).toBe("PDF-A");
  expect(textAt(".research/papers/a/data.json")).toBe("{\"a\":1}");
  expect(textAt("papers/zeta/b/metadata.yaml")).toBeUndefined();
});

it("skips a paper whose sidecar the folder already holds", async () => {
  to.put(".research/papers/b/data.json", "{}");
  expect(await moveToFolder({ from, to, logger })).toEqual({ moved: ["a"], skipped: ["b"] });
  expect(textAt("papers/zeta/b/metadata.yaml")).toBe("title: B");
});

it("leaves browser storage intact when a write fails mid-paper", async () => {
  to.failWriteOn = "papers/topic/a/paper.pdf";

  const failure = await moveToFolder({ from, to, logger }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(MoveToFolderError);
  expect(failure).toMatchObject({ paperId: "a", moved: [] });
  expect(textAt("papers/topic/a/metadata.yaml")).toBe("title: A");
  expect(textAt("papers/topic/a/paper.pdf")).toBe("PDF-A");
  expect(textAt(".research/papers/a/data.json")).toBe("{\"a\":1}");
  expect(textAt("papers/zeta/b/metadata.yaml")).toBe("title: B");
  expect(to.text("papers/topic/a/metadata.yaml")).toBeUndefined();
  expect(logger.error).toHaveBeenCalled();
});

it("leaves browser storage intact when a copied file reads back different", async () => {
  to.corruptWriteOn = ".research/papers/a/data.json";

  await expect(moveToFolder({ from, to, logger })).rejects.toBeInstanceOf(MoveToFolderError);

  expect(textAt(".research/papers/a/data.json")).toBe("{\"a\":1}");
  expect(textAt("papers/topic/a/paper.pdf")).toBe("PDF-A");
  expect(textAt("papers/zeta/b/metadata.yaml")).toBe("title: B");
});

it("copies other files only when the folder lacks them and never overwrites them", async () => {
  putFile("papers/topic/.keep", "");
  putFile(".labshelf/checklist.json", "browser");
  putFile("projects/p/labshelf.yaml", "browser project");
  putFile(".research/openalex/papers/a.json", "cache");
  to.put(".labshelf/checklist.json", "folder");

  await moveToFolder({ from, to, logger });

  expect(to.text(".labshelf/checklist.json")).toBe("folder");
  expect(to.text("projects/p/labshelf.yaml")).toBe("browser project");
  expect(to.files.has("papers/topic/.keep")).toBe(true);
  expect(to.files.has(".research/openalex/papers/a.json")).toBe(false);
  expect(textAt(".labshelf/checklist.json")).toBe("browser");
});

it("moves a paper on retry after its copy failed, because the failed copy left no folders behind", async () => {
  to.failWriteOn = "papers/topic/a/paper.pdf";
  await expect(moveToFolder({ from, to, logger })).rejects.toBeInstanceOf(MoveToFolderError);
  expect(await to.exists("papers/topic/a")).toBe(false);
  expect(await to.exists(".research/papers/a")).toBe(false);

  delete to.failWriteOn;
  expect(await moveToFolder({ from, to, logger })).toEqual({ moved: ["a", "b"], skipped: [] });
  expect(to.text("papers/topic/a/paper.pdf")).toBe("PDF-A");
  expect(textAt("papers/topic/a/paper.pdf")).toBeUndefined();
});

it("clears and counts as moved a paper whose every file the folder already holds with the same bytes", async () => {
  to.put("papers/topic/a/metadata.yaml", "title: A");
  to.put("papers/topic/a/paper.pdf", "PDF-A");
  to.put(".research/papers/a/data.json", "{\"a\":1}");
  putFile("papers/zeta/b/notes.md", "browser notes");
  to.put("papers/zeta/b/metadata.yaml", "title: B");
  to.put(".research/papers/b/data.json", "{\"b\":1}");

  expect(await moveToFolder({ from, to, logger })).toEqual({ moved: ["a"], skipped: ["b"] });
  expect(textAt("papers/topic/a/paper.pdf")).toBeUndefined();
  expect(textAt(".research/papers/a/data.json")).toBeUndefined();
  expect(textAt("papers/zeta/b/notes.md")).toBe("browser notes");
  expect(textAt("papers/zeta/b/metadata.yaml")).toBe("title: B");
});

it("clears other files the folder holds with the same bytes and keeps the ones that differ", async () => {
  putFile("papers/topic/.keep", "");
  putFile(".labshelf/checklist.json", "browser");
  putFile(".labshelf/prefs.json", "same");
  putFile("projects/p/labshelf.yaml", "browser project");
  to.put(".labshelf/checklist.json", "folder");
  to.put(".labshelf/prefs.json", "same");

  await moveToFolder({ from, to, logger });

  expect(await countPapers(from)).toBe(0);
  expect(textAt(".labshelf/checklist.json")).toBe("browser");
  expect(textAt(".labshelf/prefs.json")).toBeUndefined();
  expect(textAt("projects/p/labshelf.yaml")).toBeUndefined();
  expect(textAt("papers/topic/.keep")).toBeUndefined();
  expect(to.text("projects/p/labshelf.yaml")).toBe("browser project");
});
