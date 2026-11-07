/** Pins the parser of the page's conversation presence: a discussions path or null, and a boolean typing. */
import { parseSpacesMessage } from "../../../src/spaces/spacesProtocol";

const message = (fields: Record<string, unknown>) => ({ type: "setConversationPresence", spaceId: "thesis", path: null, typing: false, ...fields });

describe("parseSpacesMessage setConversationPresence", () => {
  it("B4 accepts a null path and a discussions path", () => {
    expect(parseSpacesMessage(message({}))).toEqual(message({}));
    expect(parseSpacesMessage(message({ path: "discussions/a.qmd", typing: true }))).toEqual(message({ path: "discussions/a.qmd", typing: true }));
  });

  it("B4 rejects another path, a non-boolean typing and a bad Space id", () => {
    expect(parseSpacesMessage(message({ path: "notes/a.qmd" }))).toBeUndefined();
    expect(parseSpacesMessage(message({ path: "discussions/../a.qmd" }))).toBeUndefined();
    expect(parseSpacesMessage(message({ path: 3 }))).toBeUndefined();
    expect(parseSpacesMessage(message({ typing: "yes" }))).toBeUndefined();
    expect(parseSpacesMessage(message({ typing: undefined }))).toBeUndefined();
    expect(parseSpacesMessage(message({ spaceId: "../x" }))).toBeUndefined();
  });
});
