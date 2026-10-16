/**
 * @jest-environment jsdom
 */
// Tests the preview build banner: busy note, failure button with its note, reload error and clearing.
import { BuildBanner } from "../../../../src/reader/dom/chrome/buildBanner";

function setup() {
  document.body.innerHTML = `<div id="build-banner" hidden></div>`;
  return { banner: new BuildBanner(), root: document.getElementById("build-banner")! };
}

describe("BuildBanner", () => {
  it("shows a building note without an action", () => {
    const { banner, root } = setup();
    banner.showBusy();
    expect(root.hidden).toBe(false);
    expect(root.textContent).toContain("Building");
    expect(root.querySelector("button")).toBeNull();
  });

  it("shows a failure as a button that runs its action, with the note beside it", () => {
    const { banner, root } = setup();
    const onClick = jest.fn();
    banner.showFailed({ label: "Build failed: 3 errors", title: "Open the logs", note: "Showing the last successful build", onClick });
    const button = root.querySelector("button")!;
    expect(button.textContent).toBe("Build failed: 3 errors");
    expect(button.title).toBe("Open the logs");
    expect(root.textContent).toContain("Showing the last successful build");
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("clears and reports a reload failure", () => {
    const { banner, root } = setup();
    banner.showBusy();
    banner.clear();
    expect(root.hidden).toBe(true);
    expect(root.childElementCount).toBe(0);
    banner.showReloadError("HTTP 404");
    expect(root.hidden).toBe(false);
    expect(root.textContent).toBe("Could not reload the PDF: HTTP 404");
  });
});
