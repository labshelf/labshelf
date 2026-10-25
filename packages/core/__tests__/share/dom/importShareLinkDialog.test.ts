/** @jest-environment jsdom */
// Tests that the import dialog refuses a link that does not parse while the user types, before any import runs.
import { runImportShareLinkDialog } from "../../../src/share/dom/index.js";
import { fakeHost } from "../../collab/dom/fakeHost";

const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>(".ls-quick input")!;
const message = (): Element => document.querySelector(".ls-quick-msg")!;
const type = (text: string): void => { input().value = text; input().dispatchEvent(new Event("input", { bubbles: true })); };
const enter = (): void => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); };

afterEach(() => { document.body.innerHTML = ""; });

describe("import shared link dialog", () => {
  it("names the parse error as the user types a malformed link and never imports it", () => {
    const host = fakeHost();
    void runImportShareLinkDialog(host);
    type("https://labshelf.org/share/#bad");
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(message().textContent).toContain("notShareLink");
    enter();
    expect(document.querySelector(".ls-quick")).not.toBeNull();
    expect(host.importLink).not.toHaveBeenCalled();
  });

  it("accepts a well-formed link", () => {
    void runImportShareLinkDialog(fakeHost());
    type("https://labshelf.org/share/#relay.example.workers.dev/0d234622993a6ca71be4ce6fd949d76c/DOVu8neJE_p2eK3MMgOCFg");
    expect(input().getAttribute("aria-invalid")).toBe("false");
  });
});
