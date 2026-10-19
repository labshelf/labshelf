// Pins the workspace hash: open tab ids and the active one, round-tripped through `#/tabs/...`.
import { formatWorkspaceHash, parseWorkspaceHash, takeJoinInvite } from "../../../src/library-page/workspace/workspaceHash";

describe("workspace hash", () => {
  it("round-trips tab ids that contain the separators", () => {
    const state = { tabs: ["library", "source:th%2Cesis:main.tex", "preview:a;b"], active: "preview:a;b" };
    const hash = formatWorkspaceHash(state);
    expect(hash.startsWith("#/tabs/")).toBe(true);
    expect(parseWorkspaceHash(hash)).toEqual(state);
  });

  it("leaves the active part out when no tab is active", () => {
    expect(formatWorkspaceHash({ tabs: ["library", "templates"], active: null })).toBe("#/tabs/library,templates");
    expect(parseWorkspaceHash("#/tabs/library,templates")).toEqual({ tabs: ["library", "templates"], active: null });
  });

  it("reads an empty tab list", () => {
    expect(parseWorkspaceHash(formatWorkspaceHash({ tabs: [], active: null }))).toEqual({ tabs: [], active: null });
  });

  it("returns null for a hash that is not a tabs hash", () => {
    expect(parseWorkspaceHash("#/papers/Refs")).toBeNull();
    expect(parseWorkspaceHash("")).toBeNull();
  });

  it("drops an active id that is not among the tabs and a malformed escape", () => {
    expect(parseWorkspaceHash("#/tabs/library;active=templates")).toEqual({ tabs: ["library"], active: null });
    expect(parseWorkspaceHash("#/tabs/library,%E0%A4%A")).toEqual({ tabs: ["library"], active: null });
  });
});

describe("join hash", () => {
  it("takes the invite from a join hash, decoded", () => {
    expect(takeJoinInvite("#/join/abc%20def")).toBe("abc def");
    expect(takeJoinInvite("#/join/labshelf%3Ajoin%2Fx")).toBe("labshelf:join/x");
  });

  it("takes nothing from any other hash or from an empty or badly encoded invite", () => {
    for (const hash of ["", "#/papers/A", "#/tabs/library", "#/join/", "#/join/%E0%A4%A"]) {
      expect(takeJoinInvite(hash)).toBeUndefined();
    }
  });
});
