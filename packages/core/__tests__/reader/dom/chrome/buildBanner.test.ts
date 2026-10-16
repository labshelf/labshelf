/**
 * @jest-environment jsdom
 */
// Tests the preview build banner: reload error and clearing.
import { BuildBanner } from "../../../../src/reader/dom/chrome/buildBanner";

function setup() {
  document.body.innerHTML = `<div id="build-banner" hidden></div>`;
  return { banner: new BuildBanner(), root: document.getElementById("build-banner")! };
}

describe("BuildBanner", () => {
  it("clears and reports a reload failure", () => {
    const { banner, root } = setup();
    banner.showReloadError("HTTP 500");
    banner.clear();
    expect(root.hidden).toBe(true);
    expect(root.childElementCount).toBe(0);
    banner.showReloadError("HTTP 404");
    expect(root.hidden).toBe(false);
    expect(root.textContent).toBe("Could not reload the PDF: HTTP 404");
  });
});
