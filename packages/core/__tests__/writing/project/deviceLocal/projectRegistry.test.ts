/** Verifies parsing and editing of the project folder registry. */
import {
  parseProjectRegistry, serializeProjectRegistry, withFolder, withProjectFolderRemoved,
} from "../../../../src/writing/project/index";

describe("parseProjectRegistry", () => {
  it("reads folders", () => {
    expect(parseProjectRegistry('{"folders":["/a","/b"]}')).toEqual({ folders: ["/a", "/b"] });
  });

  it("returns undefined for corrupt or non-object text", () => {
    expect(parseProjectRegistry("{ broken")).toBeUndefined();
    expect(parseProjectRegistry("[]")).toBeUndefined();
    expect(parseProjectRegistry("null")).toBeUndefined();
    expect(parseProjectRegistry('"x"')).toBeUndefined();
  });

  it("drops entries that are not text and reads a missing list as empty", () => {
    expect(parseProjectRegistry('{"folders":["/a",1,null,{}]}')).toEqual({ folders: ["/a"] });
    expect(parseProjectRegistry("{}")).toEqual({ folders: [] });
    expect(parseProjectRegistry('{"folders":"/a"}')).toEqual({ folders: [] });
  });
});

describe("registry edits", () => {
  it("keeps unknown keys through withFolder and serialize", () => {
    const registry = parseProjectRegistry('{"version":3,"extra":{"x":1},"folders":["/a"]}')!;
    const text = serializeProjectRegistry(withFolder(registry, "/b"));
    expect(JSON.parse(text)).toEqual({ version: 3, extra: { x: 1 }, folders: ["/a", "/b"] });
    expect(text.endsWith("\n")).toBe(true);
  });

  it("adds a folder once", () => {
    const once = withFolder({ folders: ["/a"] }, "/a");
    expect(once.folders).toEqual(["/a"]);
  });

  it("removes a folder and keeps the other keys", () => {
    expect(withProjectFolderRemoved({ folders: ["/a", "/b"], keep: true }, "/a")).toEqual({ folders: ["/b"], keep: true });
    expect(withProjectFolderRemoved({ folders: ["/a"] }, "/zzz")).toEqual({ folders: ["/a"] });
  });
});
