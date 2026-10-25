import { promises as fs } from "node:fs";

import { PaperSidecarStore } from "@labshelf/core";
import { createNodeSidecarPort } from "@labshelf/core/node";

import { SidecarReader } from "../../src/library/sidecars";
import { cleanupTempDirs, createTempLibrary, setMtime } from "../fixtures/library";

afterEach(cleanupTempDirs);

function annotation(id: string, pageNumber: number, createdAt: string, content = `text ${id}`): Record<string, unknown> {
  return {
    id, paperId: "p1", type: "highlight", pageNumber, content, color: "yellow",
    position: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 }, createdAt, updatedAt: createdAt,
  };
}

describe("SidecarReader.load", () => {
  it("returns empty data for a paper without a sidecar", async () => {
    const lib = await createTempLibrary([{ id: "p1" }]);
    expect(await new SidecarReader(lib.paths).load("p1")).toEqual({ annotations: [], theme: "auto" });
  });

  it("returns empty data for corrupt or non-object files", async () => {
    const lib = await createTempLibrary([
      { id: "garbage", sidecar: "{ this is not json" },
      { id: "array", sidecar: "[1, 2, 3]" },
      { id: "scalar", sidecar: "42" },
      { id: "empty", sidecar: "" },
    ]);
    const reader = new SidecarReader(lib.paths);
    for (const id of ["garbage", "array", "scalar", "empty"]) {
      expect(await reader.load(id)).toEqual({ annotations: [], theme: "auto" });
    }
  });

  it("reads annotations, theme and reading position", async () => {
    const reading = { page: 4, scaleValue: "1.25", updatedAt: "2025-01-02T00:00:00.000Z" };
    const lib = await createTempLibrary([{
      id: "p1",
      sidecar: { annotations: [annotation("a1", 2, "2025-01-01T00:00:00.000Z")], theme: "sepia", reading },
    }]);
    const data = await new SidecarReader(lib.paths).load("p1");
    expect(data.theme).toBe("sepia");
    expect(data.reading).toMatchObject({ page: 4, scaleValue: "1.25" });
    expect(data.annotations.map((a) => a.id)).toEqual(["a1"]);
  });

  it("drops malformed annotations and unknown themes instead of failing", async () => {
    const lib = await createTempLibrary([{
      id: "p1",
      sidecar: { annotations: [annotation("ok", 1, "2025-01-01T00:00:00.000Z"), { content: "no id" }, null, "str"], theme: "neon" },
    }]);
    const data = await new SidecarReader(lib.paths).load("p1");
    expect(data.annotations.map((a) => a.id)).toEqual(["ok"]);
    expect(data.theme).toBe("auto");
  });

  it("sorts annotations by page, then by creation time", async () => {
    const lib = await createTempLibrary([{
      id: "p1",
      sidecar: {
        annotations: [
          annotation("late-p3", 3, "2025-03-01T00:00:00.000Z"),
          annotation("p1-b", 1, "2025-02-02T00:00:00.000Z"),
          annotation("p2", 2, "2025-01-01T00:00:00.000Z"),
          annotation("p1-a", 1, "2025-02-01T00:00:00.000Z"),
          annotation("early-p3", 3, "2025-01-01T00:00:00.000Z"),
        ],
        theme: "auto",
      },
    }]);
    const data = await new SidecarReader(lib.paths).load("p1");
    expect(data.annotations.map((a) => a.id)).toEqual(["p1-a", "p1-b", "p2", "early-p3", "late-p3"]);
  });

  it("caches by mtime: an unchanged file returns the same object", async () => {
    const lib = await createTempLibrary([{ id: "p1", sidecar: { annotations: [annotation("a1", 1, "2025-01-01T00:00:00.000Z")], theme: "auto" } }]);
    const reader = new SidecarReader(lib.paths);
    const first = await reader.load("p1");
    expect(await reader.load("p1")).toBe(first);
  });

  it("picks up an external edit (another app rewrote the sidecar)", async () => {
    const lib = await createTempLibrary([{ id: "p1", sidecar: { annotations: [annotation("a1", 1, "2025-01-01T00:00:00.000Z")], theme: "auto" } }]);
    const file = lib.paths.layout.paperDataPath("p1");
    await setMtime(file, new Date("2024-01-01T00:00:00Z"));
    const reader = new SidecarReader(lib.paths);
    const first = await reader.load("p1");
    expect(first.annotations).toHaveLength(1);

    await fs.writeFile(file, JSON.stringify({
      annotations: [annotation("a1", 1, "2025-01-01T00:00:00.000Z"), annotation("a2", 2, "2025-01-02T00:00:00.000Z")],
      theme: "dark",
    }));
    await setMtime(file, new Date("2024-06-01T00:00:00Z"));

    const second = await reader.load("p1");
    expect(second).not.toBe(first);
    expect(second.annotations.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(second.theme).toBe("dark");
  });

  it("notices a sidecar that appears or disappears", async () => {
    const lib = await createTempLibrary([{ id: "p1" }]);
    const reader = new SidecarReader(lib.paths);
    expect((await reader.load("p1")).annotations).toEqual([]);

    await lib.writeSidecar("p1", { annotations: [annotation("a1", 1, "2025-01-01T00:00:00.000Z")], theme: "auto" });
    expect((await reader.load("p1")).annotations).toHaveLength(1);

    await fs.rm(lib.paths.layout.paperDataPath("p1"));
    expect((await reader.load("p1")).annotations).toEqual([]);
  });
});

describe("SidecarReader.annotationIndex", () => {
  it("maps each paper with annotations to its annotation text, one per line, in page order", async () => {
    const lib = await createTempLibrary([
      { id: "p1", sidecar: { annotations: [annotation("b", 2, "2025-01-01T00:00:00.000Z", "second page"), annotation("a", 1, "2025-01-01T00:00:00.000Z", "first page")], theme: "auto" } },
      { id: "p2", sidecar: { annotations: [], theme: "dark" } },
      { id: "p3" },
      { id: "p4", sidecar: { annotations: [annotation("c", 1, "2025-01-01T00:00:00.000Z", "only one")], theme: "auto" } },
    ]);
    const index = await new SidecarReader(lib.paths).annotationIndex(["p1", "p2", "p3", "p4", "ghost"]);
    expect([...index.keys()].sort()).toEqual(["p1", "p4"]);
    expect(index.get("p1")).toBe("first page\nsecond page");
    expect(index.get("p4")).toBe("only one");
  });

  it("accepts any iterable of ids (a Map's keys, as the app passes them)", async () => {
    const lib = await createTempLibrary([{ id: "p1", sidecar: { annotations: [annotation("a", 1, "2025-01-01T00:00:00.000Z", "hello")], theme: "auto" } }]);
    const index = await new SidecarReader(lib.paths).annotationIndex(new Map([["p1", 1]]).keys());
    expect(index.get("p1")).toBe("hello");
  });
});

describe("SidecarReader with sidecars written by the shared store", () => {
  it("reads back what the store wrote", async () => {
    const lib = await createTempLibrary([{ id: "p1" }]);
    await new PaperSidecarStore(createNodeSidecarPort(lib.paths.layout)).addHighlight("p1", 3, "an important sentence", "green");
    const viaReader = await new SidecarReader(lib.paths).load("p1");
    expect(viaReader.annotations.map((a) => a.content)).toEqual(["an important sentence"]);
  });

  it("logs a warning for a sidecar that does not parse", async () => {
    const lib = await createTempLibrary([{ id: "bad", sidecar: "{ nope" }]);
    const log = jest.fn(async () => undefined);
    await new SidecarReader(lib.paths, { log, error: jest.fn(async () => undefined) }).load("bad");
    expect(log).toHaveBeenCalledWith("WARN", "sidecar", expect.any(String), expect.objectContaining({ paperId: "bad" }));
  });
});
