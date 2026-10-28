import { formatPath } from "../../../../src/library/node/location";

describe("formatPath", () => {
  it("abbreviates the home folder", () => {
    expect(formatPath("/home/me", "/home/me")).toBe("~");
    expect(formatPath("/home/me/Dropbox/LabShelf", "/home/me")).toBe("~/Dropbox/LabShelf");
  });

  it("keeps paths outside the home folder", () => {
    expect(formatPath("/mnt/x", "/home/me")).toBe("/mnt/x");
  });
});
