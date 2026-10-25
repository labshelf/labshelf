// Pins which thumbnail bytes become data: URIs.
import { createThumbnailUri } from "../../../src/templates/host/index.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 9, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 7]);

describe("createThumbnailUri", () => {
  it("encodes PNG bytes", () => {
    expect(createThumbnailUri(PNG)).toBe(`data:image/png;base64,${Buffer.from(PNG).toString("base64")}`);
  });

  it("encodes WebP bytes", () => {
    expect(createThumbnailUri(WEBP)).toBe(`data:image/webp;base64,${Buffer.from(WEBP).toString("base64")}`);
  });

  it("refuses other formats, RIFF files that are not WebP, and empty input", () => {
    expect(createThumbnailUri(Uint8Array.from([0xff, 0xd8, 0xff]))).toBeUndefined();
    expect(createThumbnailUri(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeUndefined();
    expect(createThumbnailUri(new Uint8Array())).toBeUndefined();
  });
});
