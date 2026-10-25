// Pins the library id of each library source: fixed for browser storage, derived from the root for the bridge, the stored id for a picked folder.
import { deriveLibraryId } from "../../src/storage";

describe("deriveLibraryId", () => {
  it("names browser storage `browser`", async () => {
    expect(await deriveLibraryId({ kind: "browser", reason: "not-installed" }, undefined)).toBe("browser");
  });

  it("derives a stable bridge id from the root the helper reports", async () => {
    const id = await deriveLibraryId({ kind: "folder", root: "/home/ada/Papers", via: "bridge" }, undefined);
    expect(id).toMatch(/^bridge:[0-9a-f]{16}$/);
    expect(await deriveLibraryId({ kind: "folder", root: "/home/ada/Papers", via: "bridge" }, "picked-id")).toBe(id);
    expect(await deriveLibraryId({ kind: "folder", root: "/home/ada/Other", via: "bridge" }, undefined)).not.toBe(id);
  });

  it("uses the id stored with the picked folder", async () => {
    expect(await deriveLibraryId({ kind: "folder", root: "Papers", via: "picked" }, "abc")).toBe("abc");
  });

  it("refuses a picked folder without a stored id", async () => {
    await expect(deriveLibraryId({ kind: "folder", root: "Papers", via: "picked" }, undefined)).rejects.toThrow(/Papers/);
  });
});
