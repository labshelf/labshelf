/** @jest-environment jsdom */
// Verifies optional Spaces rows, navigation, reference drops and destructive confirmations.
import { mountLibrarySidebar, type SidebarSpaceActions } from "../../../../src/libraryUi/dom/sidebar";
import type { SidebarRow } from "../../../../src/spaces/view";

const rows: SidebarRow[] = [{ id: "s", name: "Research", tree: {
  papers: [], folders: [{ id: "f", name: "Sources", papers: [], folders: [
    { id: "g", name: "Methods", folders: [], papers: [{ id: "p", missing: false, title: "Paper", authors: [], status: "reading" }] },
  ] }],
} }];

function mount(enabled = true) {
  const spaces: SidebarSpaceActions = {
    openCatalog: jest.fn(), openSpace: jest.fn(), openPaper: jest.fn(), newSpace: jest.fn(),
    renameSpace: jest.fn(), deleteSpace: jest.fn(), newFolder: jest.fn(), renameFolder: jest.fn(),
    deleteFolder: jest.fn(), dropPapers: jest.fn(), removeReference: jest.fn(),
  };
  const slot = document.createElement("div");
  document.body.replaceChildren(slot);
  const saveCollapsed = jest.fn();
  const sidebar = mountLibrarySidebar(slot, {
    actions: { openFolder: jest.fn(), revealPaper: jest.fn(), createFolder: jest.fn(), renameFolder: jest.fn(), removeFolder: jest.fn(), searchTag: jest.fn() },
    expanded: ["space:s", "space-folder:s/f", "space-folder:s/g"], saveExpanded: jest.fn(), collapsed: [], saveCollapsed,
    ...(enabled ? { spaces } : {}),
  });
  sidebar.setSpaces(rows);
  return { slot, sidebar, spaces, saveCollapsed };
}

const row = (slot: HTMLElement, key: string): HTMLElement => slot.querySelector<HTMLElement>(`[data-key="${key}"]`)!;

function drop(target: HTMLElement, data: string): void {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types: ["application/x-labshelf-papers"], getData: () => data } });
  target.dispatchEvent(event);
}

test("omits the section when Spaces actions are absent", () => {
  expect(mount(false).slot.querySelector('[data-section="spaces"]')).toBeNull();
});

test("nests folder references with status marks and opens the focused row on Enter", () => {
  const { slot, spaces } = mount();
  const paper = row(slot, "space-paper:s/p");
  expect(paper.style.getPropertyValue("--depth")).toBe("3");
  expect(paper.innerHTML).toContain("svg");
  paper.click();
  slot.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(spaces.openPaper).toHaveBeenCalledTimes(2);
  expect(spaces.openPaper).toHaveBeenCalledWith("p");
  row(slot, "space-folder:s/g").click();
  expect(spaces.openSpace).toHaveBeenCalledWith("s", "g");
  row(slot, "all-spaces").click();
  expect(spaces.openCatalog).toHaveBeenCalledTimes(1);
});

test("accepts paper-id drops and rejects malformed payloads", () => {
  const { slot, spaces } = mount();
  const folder = row(slot, "space-folder:s/g");
  drop(folder, '["a","b"]');
  expect(spaces.dropPapers).toHaveBeenCalledWith("s", "g", ["a", "b"]);
  for (const payload of ['{"id":"a"}', '[1]', '[""]', 'null', '{']) drop(folder, payload);
  expect(spaces.dropPapers).toHaveBeenCalledTimes(1);
});

test("confirms Space deletion before asking the host", async () => {
  const { slot, spaces } = mount();
  row(slot, "space:s").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  const remove = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.includes("Delete Space"))!;
  remove.click();
  expect(spaces.deleteSpace).not.toHaveBeenCalled();
  const dialog = document.querySelector('[role="alertdialog"]')!;
  [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Delete")!.click();
  await Promise.resolve();
  await Promise.resolve();
  expect(spaces.deleteSpace).toHaveBeenCalledWith("s");
});

test("persists section collapse and exposes the heading creation action", () => {
  const { slot, sidebar, spaces, saveCollapsed } = mount();
  slot.querySelector<HTMLButtonElement>('[aria-label="New Space"]')!.click();
  expect(spaces.newSpace).toHaveBeenCalledTimes(1);
  sidebar.setSectionCollapsed("spaces", true);
  expect(saveCollapsed).toHaveBeenCalledWith(["spaces"]);
  expect(row(slot, "section:spaces").getAttribute("aria-expanded")).toBe("false");
  expect(slot.querySelector('[data-key="all-spaces"]')).toBeNull();
});

test("folds Space descendants with twisties and arrow keys without opening a page", () => {
  const { slot, spaces } = mount();
  row(slot, "space:s").querySelector<HTMLElement>(".tree-twisty")!.click();
  expect(spaces.openSpace).not.toHaveBeenCalled();
  expect(slot.querySelector('[data-key="space-folder:s/f"]')).toBeNull();
  slot.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  expect(row(slot, "space-folder:s/g")).not.toBeNull();
  slot.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  expect(slot.querySelector('[data-key="space-folder:s/f"]')).toBeNull();
  expect(spaces.openSpace).not.toHaveBeenCalled();
});

test("cancelling Space deletion leaves its data untouched", async () => {
  const { slot, spaces } = mount();
  row(slot, "space:s").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.includes("Delete Space"))!.click();
  [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent === "Cancel")!.click();
  await Promise.resolve();
  await Promise.resolve();
  expect(spaces.deleteSpace).not.toHaveBeenCalled();
});

test("removes a reference through the Space paper menu", () => {
  const { slot, spaces } = mount();
  row(slot, "space-paper:s/p").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === "Remove from Space")!.click();
  expect(spaces.removeReference).toHaveBeenCalledWith("s", "p");
});

test("confirms folder deletion before asking the host", async () => {
  const { slot, spaces } = mount();
  row(slot, "space-folder:s/g").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === "Delete folder")!.click();
  expect(spaces.deleteFolder).not.toHaveBeenCalled();
  [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent === "Delete")!.click();
  await Promise.resolve();
  await Promise.resolve();
  expect(spaces.deleteFolder).toHaveBeenCalledWith("s", "g");
});

test("keeps native button activation for the New Space action", () => {
  const { slot } = mount();
  const button = slot.querySelector<HTMLButtonElement>('[aria-label="New Space"]')!;
  for (const key of ["Enter", " "]) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
});

test("announces keyboard focus through the tree's active descendant across refreshes", () => {
  Element.prototype.scrollIntoView = () => {};
  const { slot, sidebar } = mount();
  slot.focus();
  expect(document.getElementById(slot.getAttribute("aria-activedescendant") ?? "")?.textContent).toContain("Spaces");
  slot.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  const active = slot.getAttribute("aria-activedescendant");
  expect(document.getElementById(active ?? "")?.textContent).toBe("All Spaces");
  sidebar.setSpaces(rows);
  expect(slot.getAttribute("aria-activedescendant")).toBe(active);
  expect(document.getElementById(active ?? "")).not.toBeNull();
  slot.blur();
  expect(slot.hasAttribute("aria-activedescendant")).toBe(false);
});
