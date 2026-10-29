// Tests that the Spaces page parser accepts the note and thread messages and drops malformed or path-escaping ones.
import { isSpaceQmdPath, parseSpacesMessage } from "../../src/spaces/spacesProtocol";

const SPACE = "thesis";

const valid: Record<string, Record<string, unknown>> = {
  createSpaceNote: { type: "createSpaceNote", spaceId: SPACE, title: "Ideas" },
  createSpaceThread: { type: "createSpaceThread", spaceId: SPACE, title: "Which loss?", body: "Should we use ELBO?" },
  addSpaceItem: { type: "addSpaceItem", spaceId: SPACE, path: "notes/ideas.qmd", body: "A thought" },
  editSpaceItem: { type: "editSpaceItem", spaceId: SPACE, path: "notes/ideas.qmd", id: "i1", body: "Changed" },
  removeSpaceItem: { type: "removeSpaceItem", spaceId: SPACE, path: "discussions/which-loss.qmd", id: "i1" },
  setThreadStatus: { type: "setThreadStatus", spaceId: SPACE, path: "discussions/which-loss.qmd", status: "resolved" },
};

describe("parseSpacesMessage note and thread messages", () => {
  it.each(Object.keys(valid))("10.2a accepts a valid %s", (name) => {
    expect(parseSpacesMessage(valid[name])).toEqual(valid[name]);
  });

  it("10.2a accepts setThreadStatus open", () => {
    const message = { ...valid["setThreadStatus"], status: "open" };
    expect(parseSpacesMessage(message)).toEqual(message);
  });

  it("10.2a accepts a discussions path for addSpaceItem", () => {
    const message = { ...valid["addSpaceItem"], path: "discussions/which-loss.qmd" };
    expect(parseSpacesMessage(message)).toEqual(message);
  });

  it.each(Object.keys(valid))("10.2a drops %s without spaceId", (name) => {
    const { spaceId: _spaceId, ...rest } = valid[name]!;
    expect(parseSpacesMessage(rest)).toBeUndefined();
  });

  it.each(Object.keys(valid))("10.2a drops %s with a non-string spaceId", (name) => {
    expect(parseSpacesMessage({ ...valid[name], spaceId: 7 })).toBeUndefined();
  });

  it.each([
    ["createSpaceNote", "title"],
    ["createSpaceThread", "title"],
    ["createSpaceThread", "body"],
    ["addSpaceItem", "path"],
    ["addSpaceItem", "body"],
    ["editSpaceItem", "path"],
    ["editSpaceItem", "id"],
    ["editSpaceItem", "body"],
    ["removeSpaceItem", "path"],
    ["removeSpaceItem", "id"],
    ["setThreadStatus", "path"],
    ["setThreadStatus", "status"],
  ])("10.2a drops %s with %s missing", (name, field) => {
    const { [field]: _removed, ...rest } = valid[name]!;
    expect(parseSpacesMessage(rest)).toBeUndefined();
  });

  it.each([
    ["createSpaceNote", "title"],
    ["createSpaceThread", "title"],
    ["createSpaceThread", "body"],
    ["addSpaceItem", "path"],
    ["addSpaceItem", "body"],
    ["editSpaceItem", "path"],
    ["editSpaceItem", "id"],
    ["editSpaceItem", "body"],
    ["removeSpaceItem", "path"],
    ["removeSpaceItem", "id"],
    ["setThreadStatus", "path"],
    ["setThreadStatus", "status"],
  ])("10.2a drops %s with %s of the wrong type", (name, field) => {
    expect(parseSpacesMessage({ ...valid[name], [field]: 42 })).toBeUndefined();
  });

  it("10.2a drops setThreadStatus with a status other than open or resolved", () => {
    expect(parseSpacesMessage({ ...valid["setThreadStatus"], status: "closed" })).toBeUndefined();
  });
});

describe("path validation in the note and thread messages", () => {
  const pathMessages = ["addSpaceItem", "editSpaceItem", "removeSpaceItem", "setThreadStatus"];
  const escapes: [string, string][] = [
    ["a parent segment", "notes/../space.json.qmd"],
    ["a leading parent segment", "../other/notes/a.qmd"],
    ["an absolute path", "/etc/notes/a.qmd"],
    ["an absolute path into the Space", "/lib/spaces/thesis/notes/a.qmd"],
    ["another Space folder", "spaces/other/notes/a.qmd"],
    ["a file that is not .qmd", "notes/a.md"],
    ["a folder outside notes and discussions", "other/a.qmd"],
    ["the Space root", "a.qmd"],
  ];

  describe.each(pathMessages)("%s", (name) => {
    it.each(escapes)("10.2b drops a path with %s", (_label, path) => {
      expect(parseSpacesMessage({ ...valid[name], path })).toBeUndefined();
    });
  });

  describe("isSpaceQmdPath", () => {
    it("10.2b accepts a .qmd under notes/", () => {
      expect(isSpaceQmdPath(SPACE, "notes/ideas.qmd")).toBe(true);
    });

    it("10.2b accepts a .qmd under discussions/", () => {
      expect(isSpaceQmdPath(SPACE, "discussions/which-loss.qmd")).toBe(true);
    });

    it.each(escapes)("10.2b rejects %s", (_label, path) => {
      expect(isSpaceQmdPath(SPACE, path)).toBe(false);
    });

    it.each([[undefined], [null], [42], [{}], [["notes/a.qmd"]], [""]])("10.2b rejects the non-path %p", (value) => {
      expect(isSpaceQmdPath(SPACE, value)).toBe(false);
    });
  });
});
