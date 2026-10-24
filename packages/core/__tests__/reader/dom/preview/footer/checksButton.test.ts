/**
 * @jest-environment jsdom
 */
// Tests the footer checks button: its count, its absence before the first check and the command it runs.
import { mountChecksButton } from "../../../../../src/reader/dom/preview/footer/index";
import type { PreviewRoots } from "../../../../../src/reader/previewProtocol";

function roots(checks?: number): PreviewRoots {
  const root = { path: "/p/main.tex", failed: false, rawLog: true, sourceLinks: true, problems: [] };
  return { main: "/p/main.tex", focused: "/p/main.tex", shown: "/p/main.tex", roots: [root], ...(checks === undefined ? {} : { checks }) };
}

function setup() {
  document.body.innerHTML = `<span id="slot" hidden></span>`;
  const slot = document.getElementById("slot")!;
  const post = jest.fn();
  const checks = mountChecksButton(slot, { post });
  return { slot, post, checks, button: () => slot.querySelector<HTMLButtonElement>("button") };
}

describe("checks button", () => {
  it("stays hidden before the first check", () => {
    const { slot, checks } = setup();
    checks.setRoots(roots());
    expect(slot.hidden).toBe(true);
  });

  it("shows the finding count", () => {
    const { slot, checks, button } = setup();
    checks.setRoots(roots(3));
    expect(slot.hidden).toBe(false);
    expect(button()!.textContent).toBe("3 checks");
    checks.setRoots(roots(1));
    expect(button()!.textContent).toBe("1 check");
  });

  it("hides again when the count goes away", () => {
    const { slot, checks } = setup();
    checks.setRoots(roots(2));
    checks.setRoots(roots());
    expect(slot.hidden).toBe(true);
  });

  it("runs the pre-submission check on click", () => {
    const { post, checks, button } = setup();
    checks.setRoots(roots(0));
    button()!.click();
    expect(post).toHaveBeenCalledWith({ command: "runCommand", id: "checkBeforeSubmitting" });
  });
});
