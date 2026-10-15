/**
 * @jest-environment jsdom
 */
// Tests the preview build banner: busy note, failure button that asks for the first error, and clearing on success.
import { BuildBanner } from "../../../../src/reader/dom/chrome/buildBanner";
import type { HostBridge } from "../../../../src/reader/dom/session/hostBridge";

function setup() {
  document.body.innerHTML = `<div id="build-banner" hidden></div>`;
  const post = jest.fn();
  const banner = new BuildBanner({ post } as unknown as HostBridge);
  return { banner, post, root: document.getElementById("build-banner")! };
}

describe("BuildBanner", () => {
  it("shows a building note without an action", () => {
    const { banner, root } = setup();
    banner.show("building", 0);
    expect(root.hidden).toBe(false);
    expect(root.textContent).toContain("Building");
    expect(root.querySelector("button")).toBeNull();
  });

  it("shows a failed build's error count as a button that asks the host for the first error", () => {
    const { banner, post, root } = setup();
    banner.show("failed", 3);
    const button = root.querySelector("button")!;
    expect(button.textContent).toBe("Build failed: 3 errors");
    expect(root.textContent).toContain("Showing the last successful build");
    button.click();
    expect(post).toHaveBeenCalledWith({ command: "showBuildProblem" });
  });

  it("names one error in the singular and omits a zero count", () => {
    const { banner, root } = setup();
    banner.show("failed", 1);
    expect(root.querySelector("button")!.textContent).toBe("Build failed: 1 error");
    banner.show("failed", 0);
    expect(root.querySelector("button")!.textContent).toBe("Build failed");
  });

  it("clears on success and reports a reload failure", () => {
    const { banner, root } = setup();
    banner.show("failed", 2);
    banner.show("succeeded", 0);
    expect(root.hidden).toBe(true);
    banner.showReloadError("HTTP 404");
    expect(root.hidden).toBe(false);
    expect(root.textContent).toBe("Could not reload the PDF: HTTP 404");
  });
});
