// Tests that the Spaces guard accepts space.runCell and space.cancelCell and drops them whole with a missing or mistyped field.
import { parseSpacesMessage } from "../src/spaces/spacesProtocol";

const run = { type: "space.runCell", path: "notes/ideas.qmd", itemId: "i1", label: "calc", code: "print(1)", language: "python", requestId: "r1" };
const cancel = { type: "space.cancelCell", requestId: "r1" };

describe("space.runCell and space.cancelCell guards", () => {
  it("12.5a accepts a valid space.runCell", () => { expect(parseSpacesMessage(run)).toEqual(run); });
  it("12.5a accepts a valid space.runCell for a discussions path", () => {
    const m = { ...run, path: "discussions/which-loss.qmd" };
    expect(parseSpacesMessage(m)).toEqual(m);
  });
  it("12.5a accepts a valid space.cancelCell", () => { expect(parseSpacesMessage(cancel)).toEqual(cancel); });

  it.each(["path", "itemId", "label", "code", "requestId"])("12.5a drops space.runCell without %s", (field) => {
    const { [field]: _gone, ...rest } = run as Record<string, unknown>;
    expect(parseSpacesMessage(rest)).toBeUndefined();
  });
  it.each(["path", "itemId", "label", "code", "requestId"])("12.5a drops space.runCell with an empty %s", (field) => {
    expect(parseSpacesMessage({ ...run, [field]: "" })).toBeUndefined();
  });
  it.each(["path", "itemId", "label", "code", "requestId"])("12.5a drops space.runCell with a non-string %s", (field) => {
    expect(parseSpacesMessage({ ...run, [field]: 7 })).toBeUndefined();
  });
  it("12.5a drops space.runCell with a path that escapes the Space notes", () => {
    expect(parseSpacesMessage({ ...run, path: "./outside.qmd" })).toBeUndefined();
  });
  it.each(["notes.qmd", "papers/a.qmd", "projects/p/notes.qmd", "other/ideas.qmd", "/notes/ideas.qmd"])(
    "12.5a drops space.runCell with the path %s outside notes/ and discussions/", (path) => {
      expect(parseSpacesMessage({ ...run, path })).toBeUndefined();
    });
  it("12.5a drops space.cancelCell without, with an empty, or with a non-string requestId", () => {
    expect(parseSpacesMessage({ type: "space.cancelCell" })).toBeUndefined();
    expect(parseSpacesMessage({ type: "space.cancelCell", requestId: "" })).toBeUndefined();
    expect(parseSpacesMessage({ type: "space.cancelCell", requestId: 3 })).toBeUndefined();
  });
});
