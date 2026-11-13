/** @jest-environment jsdom */
// Tests the clipboard rows of a right-click menu: which rows show, when Cut and Copy are disabled, and that Paste inserts the clipboard's text.
import { editMenuEntries, type EditMenuActions } from "../../../../src/ui/dom/widgets/editMenu";
import type { MenuItem } from "../../../../src/ui/dom/widgets/menu";

const labels = (actions: EditMenuActions): string[] => editMenuEntries(actions).map((entry) => (entry as MenuItem).label);

describe("editMenuEntries", () => {
  it("lists Cut, Copy, Paste and Select all when the surface can do them all", () => {
    expect(labels({ hasSelection: true, copy: jest.fn(), cut: jest.fn(), paste: jest.fn(), selectAll: jest.fn() })).toEqual(["Cut", "Copy", "Paste", "Select all"]);
  });

  it("leaves Cut and Paste out on read-only text", () => {
    expect(labels({ hasSelection: true, copy: jest.fn() })).toEqual(["Copy"]);
  });

  it("disables Cut and Copy without a selection", () => {
    const [cut, copy] = editMenuEntries({ hasSelection: false, copy: jest.fn(), cut: jest.fn() }) as MenuItem[];
    expect(cut!.disabled).toBe(true);
    expect(copy!.disabled).toBe(true);
  });

  it("pastes the clipboard's text", async () => {
    const paste = jest.fn();
    Object.assign(navigator, { clipboard: { readText: jest.fn().mockResolvedValue("hello") } });
    const row = editMenuEntries({ hasSelection: false, copy: jest.fn(), paste }).find((entry) => (entry as MenuItem).label === "Paste") as MenuItem;
    row.onSelect();
    await Promise.resolve();
    await Promise.resolve();
    expect(paste).toHaveBeenCalledWith("hello");
  });
});
