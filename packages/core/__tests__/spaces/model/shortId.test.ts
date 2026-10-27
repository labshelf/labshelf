/** Verifies that short entry ids are lowercase hex and unique within the ids already in the file. */
import { createEntryId } from "../../../src/spaces/index";

describe("createEntryId", () => {
  it("gives an 8-character hex id", () => {
    expect(createEntryId(new Set())).toMatch(/^[0-9a-f]{8}$/);
  });

  it("draws again when the id is already taken", () => {
    const draws = [new Uint8Array([0, 0, 0, 1]), new Uint8Array([0, 0, 0, 2])];
    const fill = (bytes: Uint8Array) => { bytes.set(draws.shift()!); };
    expect(createEntryId(new Set(["00000001"]), fill)).toBe("00000002");
  });
});
