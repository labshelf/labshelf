/** @jest-environment jsdom */
// Pins which blob: URLs of the preview frame stay alive while the reader may still be fetching them.
import { createPreviewFrame } from "../../../src/library-page/preview";

describe("createPreviewFrame blob URLs", () => {
  let created = 0;
  const revoked: string[] = [];

  beforeEach(() => {
    created = 0;
    revoked.length = 0;
    URL.createObjectURL = () => `blob:test/${++created}`;
    URL.revokeObjectURL = (url: string) => { revoked.push(url); };
  });

  it("revokes a URL only when a third PDF arrives", () => {
    const frame = createPreviewFrame(document.body, { id: "p", title: "P" });
    frame.showPdf(new Uint8Array([1]));
    frame.showPdf(new Uint8Array([2]));
    expect(revoked).toEqual([]);
    frame.showPdf(new Uint8Array([3]));
    expect(revoked).toEqual(["blob:test/1"]);
    frame.dispose();
  });

  it("revokes the remaining URLs and removes the iframe on dispose", () => {
    const frame = createPreviewFrame(document.body, { id: "p", title: "P" });
    frame.showPdf(new Uint8Array([1]));
    frame.showPdf(new Uint8Array([2]));
    frame.showPdf(new Uint8Array([3]));
    frame.dispose();
    expect(revoked).toEqual(["blob:test/1", "blob:test/2", "blob:test/3"]);
    expect(document.querySelector("iframe")).toBeNull();
  });
});
