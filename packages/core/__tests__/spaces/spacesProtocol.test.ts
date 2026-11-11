// Tests that the Spaces page parser accepts the note and thread messages and drops malformed or path-escaping ones.
import { isSpaceQmdPath, parseSpacesMessage } from "../../src/spaces/spacesProtocol";
import { parseDateDraft } from "../../src/spaces/parseSpaceDrafts";

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

describe("parseSpacesMessage space.noteFile (plan charts 3.3)", () => {
  const read = { type: "noteFile.read", requestId: "r1", path: "assets/ab12cd34.csv" };

  it("accepts read, write and pick requests beside a Space note", () => {
    for (const request of [read, { type: "noteFile.write", requestId: "r2", path: "assets/ab12cd34.csv", base64: "YQ==" }, { type: "noteFile.pick", requestId: "r3", accept: [".csv"] }]) {
      const message = { type: "space.noteFile", spaceId: SPACE, path: "notes/ideas.qmd", request };
      expect(parseSpacesMessage(message)).toEqual(message);
    }
  });

  it("rejects a bad note path or a malformed or unsafe request", () => {
    expect(parseSpacesMessage({ type: "space.noteFile", spaceId: SPACE, path: "../ideas.qmd", request: read })).toBeUndefined();
    expect(parseSpacesMessage({ type: "space.noteFile", spaceId: SPACE, path: "notes/ideas.qmd" })).toBeUndefined();
    expect(parseSpacesMessage({ type: "space.noteFile", spaceId: SPACE, path: "notes/ideas.qmd", request: { ...read, path: "C:/x.csv" } })).toBeUndefined();
  });
});

const ref = { path: "discussions/loss.qmd", itemId: "m1" };

describe("discussion record and search validators", () => {
  it.each([
    [{ type: "toggleSaved", id: "alpha", ...ref }],
    [{ type: "addAgreement", id: "alpha", agreement: { ...ref, text: "Huber" } }],
    [{ type: "updateAgreement", id: "alpha", agreementId: "a1", text: "Huber" }],
    [{ type: "removeAgreement", id: "alpha", agreementId: "a1" }],
    [{ type: "searchDiscussions", spaceId: "alpha", query: "loss" }],
  ])("accepts %j", (message) => {
    expect(parseSpacesMessage(message)).toEqual(message);
  });

  it.each([
    [{ type: "toggleSaved", id: "alpha", path: "../x.qmd", itemId: "m1" }],
    [{ type: "addAgreement", id: "alpha", agreement: { ...ref, text: " " } }],
    [{ type: "updateAgreement", id: "alpha", agreementId: "", text: "x" }],
    [{ type: "searchDiscussions", spaceId: "../alpha", query: "loss" }],
    [{ type: "searchDiscussions", spaceId: "alpha" }],
  ])("rejects %j", (message) => {
    expect(parseSpacesMessage(message)).toBeUndefined();
  });

  it("parses task and meeting drafts with their new fields and refuses an end before the start", () => {
    expect(parseDateDraft({ kind: "task", title: "Run", date: "2026-11-05", done: false, assignee: " Bo ", source: ref }))
      .toEqual({ kind: "task", title: "Run", date: "2026-11-05", done: false, assignee: "Bo", source: ref });
    expect(parseDateDraft({ kind: "meeting", title: "Sync", date: "2026-11-06", start: "14:00", end: "15:00", participants: ["Ana"], agenda: "x", source: ref }))
      .toEqual({ kind: "meeting", title: "Sync", date: "2026-11-06", start: "14:00", end: "15:00", participants: ["Ana"], agenda: "x", source: ref });
    expect(parseDateDraft({ kind: "meeting", title: "Sync", date: "2026-11-06", start: "15:00", end: "14:00" })).toBeUndefined();
    expect(parseDateDraft({ kind: "task", title: "Run", date: "2026-11-05", done: false, source: { path: "x" } })).toBeUndefined();
  });
});

describe("parseSpacesMessage space.paperObjects", () => {
  const request = { type: "paperObjects.request", requestId: "r1", call: { op: "insert", paperId: "p1", object: { kind: "equation", label: "3", page: 1, box: { x: 0.1, y: 0.2, w: 0.5, h: 0.05 }, caption: "E = mc^2" }, options: { assetName: "a1", takenLabels: ["1"] } } };
  it("accepts a well-formed request", () => {
    expect(parseSpacesMessage({ type: "space.paperObjects", request })).toEqual({ type: "space.paperObjects", request });
  });
  it("drops a malformed request", () => {
    expect(parseSpacesMessage({ type: "space.paperObjects" })).toBeUndefined();
    expect(parseSpacesMessage({ type: "space.paperObjects", request: { ...request, call: { ...request.call, options: { assetName: "", takenLabels: [] } } } })).toBeUndefined();
  });
});
