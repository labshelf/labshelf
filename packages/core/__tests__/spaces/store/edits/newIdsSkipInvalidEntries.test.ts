/** Verifies that new folder, date and term ids never reuse an id held by an invalid entry kept for write-back. */
import { withDate, withFolder, withTerm } from "../../../../src/spaces/store/edits/index";
import type { Glossary, Space } from "../../../../src/spaces/model/index";

const TAKEN = "00000001";
const held = { id: TAKEN, name: 3 };

const space: Space = {
  id: "s", name: "S", folders: [], papers: [], projects: [], dates: [],
  invalid: { folders: [held], papers: [], projects: [], dates: [held] }, extra: {},
};
const glossary: Glossary = { terms: [], invalidTerms: [held], extra: {} };

/** Random bytes that count up from 00000001, so the first id drawn collides with the invalid entry. */
function countingRandom(): void {
  let next = 1;
  jest.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(bytes: T): T => {
    new DataView((bytes as ArrayBufferView).buffer).setUint32(0, next);
    next += 1;
    return bytes;
  });
}

beforeEach(countingRandom);
afterEach(() => { jest.restoreAllMocks(); });

describe("new ids skip invalid entries", () => {
  it("withFolder", () => {
    expect(withFolder(space, "A", undefined).value).toBe("00000002");
  });

  it("withDate", () => {
    expect(withDate(space, { kind: "deadline", title: "Due", date: "2026-11-14" }).value).toBe("00000002");
  });

  it("withTerm", () => {
    expect(withTerm(glossary, { term: "a", definition: "b" }).value).toBe("00000002");
  });
});
