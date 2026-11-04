// Tests that the Spaces page parser accepts the share and download messages and rejects invalid ones whole.
import { parseSpacesMessage } from "../../../src/spaces/spacesProtocol";

describe("parseSpacesMessage share messages", () => {
  it.each([
    [{ type: "shareSpace", id: "thesis" }],
    [{ type: "leaveSpace", id: "thesis" }],
    [{ type: "downloadSpacePapers", id: "thesis", what: { kind: "paper", paperId: "p1" } }],
    [{ type: "downloadSpacePapers", id: "thesis", what: { kind: "folder", folderId: "f1" } }],
    [{ type: "downloadSpacePapers", id: "thesis", what: { kind: "space" } }],
  ])("accepts %j", (message) => {
    expect(parseSpacesMessage(message)).toEqual(message);
  });

  it("drops fields it does not know", () => {
    expect(parseSpacesMessage({ type: "downloadSpacePapers", id: "t", what: { kind: "space", extra: 1 }, other: 2 }))
      .toEqual({ type: "downloadSpacePapers", id: "t", what: { kind: "space" } });
  });

  it.each([
    [{ type: "shareSpace" }],
    [{ type: "shareSpace", id: "" }],
    [{ type: "leaveSpace", id: 3 }],
    [{ type: "downloadSpacePapers", id: "t" }],
    [{ type: "downloadSpacePapers", id: "t", what: null }],
    [{ type: "downloadSpacePapers", id: "t", what: { kind: "all" } }],
    [{ type: "downloadSpacePapers", id: "t", what: { kind: "paper" } }],
    [{ type: "downloadSpacePapers", id: "t", what: { kind: "paper", paperId: "" } }],
    [{ type: "downloadSpacePapers", id: "t", what: { kind: "folder", paperId: "p1" } }],
    [{ type: "downloadSpacePapers", what: { kind: "space" } }],
  ])("rejects %j", (message) => {
    expect(parseSpacesMessage(message)).toBeUndefined();
  });
});
