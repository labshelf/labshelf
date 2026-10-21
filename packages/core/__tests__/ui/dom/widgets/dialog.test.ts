/**
 * @jest-environment jsdom
 */
// Tests that the confirmation dialog is named by its title and described by its message.
import { showDialog } from "../../../../src/ui/dom/widgets/dialog";

afterEach(() => { document.body.innerHTML = ""; });

const textOf = (ids: string | null): string =>
  (ids ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ");

describe("showDialog accessible name", () => {
  it("labels the alertdialog with its title and describes it with its message", () => {
    void showDialog({ title: "Stop sharing?", message: "Others lose access.", buttons: [{ id: "ok", label: "OK" }] });
    const box = document.querySelector('[role="alertdialog"]')!;
    expect(textOf(box.getAttribute("aria-labelledby"))).toBe("Stop sharing?");
    expect(textOf(box.getAttribute("aria-describedby"))).toBe("Others lose access.");
  });

  it("gives each open dialog its own ids and no description without a message", () => {
    void showDialog({ title: "One", buttons: [] });
    void showDialog({ title: "Two", buttons: [] });
    const boxes = [...document.querySelectorAll('[role="alertdialog"]')];
    expect(boxes.map((b) => textOf(b.getAttribute("aria-labelledby")))).toEqual(["One", "Two"]);
    expect(boxes[0]!.hasAttribute("aria-describedby")).toBe(false);
  });
});
