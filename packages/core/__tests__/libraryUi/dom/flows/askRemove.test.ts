/**
 * @jest-environment jsdom
 */
import { mountForTest, paper } from "../mountHarness";

describe("confirm before remove", () => {
  it("asks once, then clears the selection and asks the host to remove", async () => {
    const t = mountForTest();
    t.snapshot([paper("a", "papers", { title: "Alpha" }), paper("b", "papers")], ["papers/a"]);
    t.lib.store.set({ selected: new Set(["a", "b"]), anchor: "a", cursor: "a" });
    t.key("Delete");
    expect(document.querySelector(".ls-dialog-title")?.textContent).toBe("Remove 2 papers from the library?");
    expect(document.querySelector(".ls-dialog-msg")?.textContent).toBe("Their folders and files are deleted from the library on this device and on every synced device.");
    [...document.querySelectorAll<HTMLButtonElement>(".ls-dialog button")].find((b) => b.textContent === "Remove")!.click();
    await Promise.resolve();
    expect(t.sent.at(-1)).toEqual({ type: "paper.remove", ids: ["a", "b"] });
    expect(t.lib.store.get().selected.size).toBe(0);
  });

  it("removes nothing when the dialog is cancelled", async () => {
    const t = mountForTest();
    t.snapshot([paper("a", "papers")]);
    t.lib.store.set({ selected: new Set(["a"]), anchor: "a", cursor: "a" });
    t.key("Delete");
    [...document.querySelectorAll<HTMLButtonElement>(".ls-dialog button")].find((b) => b.textContent === "Cancel")!.click();
    await Promise.resolve();
    expect(t.sent.some((m) => m.type === "paper.remove")).toBe(false);
    expect(t.lib.store.get().selected.size).toBe(1);
  });
});
