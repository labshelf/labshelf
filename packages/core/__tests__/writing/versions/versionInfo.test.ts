// Tests that version.json is validated on read and round-trips.
import { parseVersionFile, serializeVersionFile } from "../../../src/writing/versions/index";

const CREATED = "2026-10-15T21:40:12.000Z";

describe("parseVersionFile", () => {
  it("reads a valid file with the folder slug", () => {
    expect(parseVersionFile("camera-ready", JSON.stringify({ name: "Camera-ready", created: CREATED })))
      .toEqual({ slug: "camera-ready", name: "Camera-ready", created: CREATED });
  });

  it("round-trips through serializeVersionFile", () => {
    const text = serializeVersionFile({ name: "Réponse 2", created: CREATED });
    expect(parseVersionFile("reponse-2", text)).toEqual({ slug: "reponse-2", name: "Réponse 2", created: CREATED });
  });

  it.each([
    ["not json", "{nope"],
    ["an array", "[]"],
    ["null", "null"],
    ["a missing name", JSON.stringify({ created: CREATED })],
    ["an empty name", JSON.stringify({ name: " ", created: CREATED })],
    ["a non-string name", JSON.stringify({ name: 3, created: CREATED })],
    ["a missing created", JSON.stringify({ name: "x" })],
    ["an invalid created", JSON.stringify({ name: "x", created: "yesterday" })],
  ])("returns undefined for %s", (_label, text) => {
    expect(parseVersionFile("x", text)).toBeUndefined();
  });
});
