/** Verifies the split of labshelf.yaml into shared settings and the per-user keys each copy keeps. */
import * as Y from "yjs";
import { applySharedSettings, readSettingsMap, parseSharedSettings, writeSettingsMap } from "../../../src/collab/model/index";

const LOCAL = [
  "# my project",
  "id: paper-a",
  "format: latex",
  "main: main.tex # entry",
  "folder: Thesis",
  "archived: true",
  "trashed: 2026-10-01T00:00:00.000Z",
  "shared: s-1",
  "engine: xelatex",
  "colour: blue",
  "",
].join("\n");

describe("parseSharedSettings", () => {
  it("takes the shared keys and leaves per-user and unknown keys out", () => {
    expect(parseSharedSettings(LOCAL)).toEqual({ format: "latex", main: "main.tex", engine: "xelatex" });
  });

  it("reads nested keys as plain values", () => {
    const text = "id: a\nformat: typst\ntypst: '0.13'\ncheck:\n  pages: 8\nvalues: [v.json]\n";
    expect(parseSharedSettings(text)).toEqual({ format: "typst", typst: "0.13", check: { pages: 8 }, values: ["v.json"] });
  });

  it("throws on text that is not YAML", () => {
    expect(() => parseSharedSettings("a: [")).toThrow(/labshelf\.yaml/);
  });
});

describe("applySharedSettings", () => {
  it("writes shared keys and keeps per-user keys, comments and unknown keys", () => {
    const next = applySharedSettings(LOCAL, { format: "latex", main: "paper.tex", engine: "xelatex", title: "Shared title" });
    expect(next).toContain("# my project");
    expect(next).toContain("id: paper-a");
    expect(next).toContain("folder: Thesis");
    expect(next).toContain("archived: true");
    expect(next).toContain("shared: s-1");
    expect(next).toContain("colour: blue");
    expect(next).toContain("main: paper.tex");
    expect(next).toContain("title: Shared title");
    expect(parseSharedSettings(next)).toEqual({ format: "latex", main: "paper.tex", engine: "xelatex", title: "Shared title" });
  });

  it("removes a shared key absent from the shared settings", () => {
    const next = applySharedSettings(LOCAL, { format: "latex", main: "main.tex" });
    expect(next).not.toContain("engine:");
    expect(next).toContain("main: main.tex # entry");
  });

  it("does not take per-user keys from the shared settings", () => {
    const next = applySharedSettings(LOCAL, { format: "latex", id: "other", folder: "Elsewhere" } as Record<string, unknown>);
    expect(next).toContain("id: paper-a");
    expect(next).toContain("folder: Thesis");
  });
});

describe("settings map", () => {
  it("round-trips the shared settings through the index doc and removes dropped keys", () => {
    const doc = new Y.Doc();
    const map = doc.getMap("settings");
    writeSettingsMap(map, { format: "latex", main: "main.tex", check: { pages: 8 } });
    writeSettingsMap(map, { format: "latex", check: { pages: 10 } });
    expect(readSettingsMap(map)).toEqual({ format: "latex", check: { pages: 10 } });
  });

  it("leaves an unchanged key alone so no update is sent", () => {
    const doc = new Y.Doc();
    const map = doc.getMap("settings");
    writeSettingsMap(map, { format: "latex", main: "main.tex" });
    let updates = 0;
    doc.on("update", () => { updates += 1; });
    writeSettingsMap(map, { format: "latex", main: "main.tex" });
    expect(updates).toBe(0);
  });
});
