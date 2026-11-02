/**
 * Tests catalog filtering, navigation, creation and subscription cleanup.
 * @jest-environment jsdom
 */
import { createLoopbackTransport } from "../../../../src/libraryUi/protocol/index.js";
import type { HostToSpaces, SpacesToHost } from "../../../../src/spaces/spacesProtocol.js";
import type { CatalogRow } from "../../../../src/spaces/spaceViews.js";
import { mountSpacesCatalog } from "../../../../src/spaces/dom/mountSpacesCatalog.js";

const row = (id: string, name: string, purpose: string, place: CatalogRow["place"] = "spaces"): CatalogRow => ({
  id, name, purpose, reading: { done: 1, total: 2 }, next: null,
  counts: { papers: 2, projects: 1 }, place, ...(place === "trash" ? { trashedAt: "2026-05-01T10:00:00.000Z" } : {}),
});

function setup() {
  document.body.replaceChildren();
  const root = document.createElement("main");
  document.body.append(root);
  const { ui, host } = createLoopbackTransport<SpacesToHost, HostToSpaces>();
  const posted: SpacesToHost[] = [];
  host.subscribe((message) => posted.push(message));
  const dispose = mountSpacesCatalog(root, ui);
  host.post({ type: "catalog", rows: [row("a", "Thesis", "Reading attention"), row("b", "Biology", "Cells"), row("c", "Old", "Done", "archived"), row("d", "Gone", "Bin", "trash")] });
  return { root, host, posted, dispose };
}

const names = (root: ParentNode): string[] => [...root.querySelectorAll(".catalog-title")].map((t) => t.textContent ?? "");
const tab = (root: ParentNode, place: string): HTMLElement => root.querySelector<HTMLElement>(`[data-place="${place}"]`)!;
const key = (target: EventTarget, k: string): void => { target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); };
function menuItem(label: string): HTMLButtonElement {
  return [...document.querySelectorAll<HTMLButtonElement>(".ls-menu-item")].find((b) => b.textContent?.includes(label))!;
}
async function confirm(): Promise<void> {
  await Promise.resolve();
  [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.classList.contains("ls-btn-primary"))!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function button(root: ParentNode, text: string): HTMLButtonElement {
  return [...root.querySelectorAll("button")].find((b) => b.textContent === text)!;
}

describe("mountSpacesCatalog", () => {
  it("requests the catalog and keeps search focused while narrowing by purpose", () => {
    const { root, posted } = setup();
    expect(posted).toEqual([{ type: "ready", view: "catalog" }]);
    jest.useFakeTimers();
    const input = root.querySelector<HTMLInputElement>("input.catalog-search")!;
    const type = (text: string): void => { input.value = text; input.dispatchEvent(new Event("input")); jest.advanceTimersByTime(80); };
    input.focus(); type("attention");
    expect(root.querySelectorAll(".catalog-row")).toHaveLength(1);
    expect(document.activeElement).toBe(input);
    type("nothing");
    expect(root.querySelectorAll(".catalog-row")).toHaveLength(0);
    expect(root.textContent).toContain("No matching Spaces.");
    type("");
    expect(root.querySelectorAll(".catalog-row")).toHaveLength(2);
    jest.useRealTimers();
  });

  it("shows the three places with counts and only the rows of the chosen one", () => {
    const { root } = setup();
    expect([...root.querySelectorAll(".ls-place-tab")].map((t) => t.textContent)).toEqual(["All Spaces2", "Archived1", "Trash1"]);
    expect(names(root)).toEqual(["Thesis", "Biology"]);
    tab(root, "archived").click();
    expect(names(root)).toEqual(["Old"]);
    key(tab(root, "archived"), "ArrowRight");
    expect(names(root)).toEqual(["Gone"]);
    key(tab(root, "trash"), "ArrowLeft");
    expect(names(root)).toEqual(["Old"]);
    expect(tab(root, "archived").getAttribute("aria-selected")).toBe("true");
  });

  it("explains an empty place", () => {
    const { root, host } = setup();
    host.post({ type: "catalog", rows: [row("a", "Thesis", "x")] });
    tab(root, "archived").click();
    expect(root.textContent).toContain("No archived Spaces");
    tab(root, "trash").click();
    expect(root.textContent).toContain("Trash is empty");
  });

  it("hides New Space in Trash and empties it only after confirming", async () => {
    const { root, posted } = setup();
    const add = root.querySelector<HTMLButtonElement>('[data-act="new"]')!;
    const empty = root.querySelector<HTMLButtonElement>('[data-act="empty-trash"]')!;
    expect([add.hidden, empty.hidden]).toEqual([false, true]);
    tab(root, "trash").click();
    expect([add.hidden, empty.hidden, empty.disabled]).toEqual([true, false, false]);
    empty.click();
    await Promise.resolve();
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Empty Trash?");
    expect(posted).toHaveLength(1);
    await confirm();
    expect(posted.at(-1)).toEqual({ type: "emptyTrash" });
  });

  it("disables Empty trash when Trash is empty", () => {
    const { root, host } = setup();
    host.post({ type: "catalog", rows: [row("a", "Thesis", "x")] });
    tab(root, "trash").click();
    expect(root.querySelector<HTMLButtonElement>('[data-act="empty-trash"]')!.disabled).toBe(true);
  });

  it("offers the actions of each place from the card menu", async () => {
    const { root, posted } = setup();
    const openMenu = (): void => root.querySelector<HTMLButtonElement>('.catalog-menu[title="Space actions"]')!.click();
    openMenu();
    expect([...document.querySelectorAll(".ls-menu-item")].map((i) => i.textContent)).toEqual(["Open", "Archive", "Move to Trash"]);
    menuItem("Archive").click();
    openMenu(); menuItem("Move to Trash").click();
    openMenu(); menuItem("Open").click();
    expect(posted.slice(1)).toEqual([
      { type: "setArchived", id: "a", archived: true },
      { type: "setTrashed", id: "a", trashed: true },
      { type: "openSpace", id: "a", tab: "overview" },
    ]);
    posted.length = 0;
    tab(root, "archived").click();
    openMenu(); menuItem("Unarchive").click();
    expect(posted).toEqual([{ type: "setArchived", id: "c", archived: false }]);
    tab(root, "trash").click();
    openMenu(); menuItem("Restore").click();
    expect(posted.at(-1)).toEqual({ type: "setTrashed", id: "d", trashed: false });
    expect(menuItem("Restore")).toBeUndefined();
    expect(root.textContent).toContain("Moved to Trash");
    await Promise.resolve();
  });

  it("posts deleteSpace from Trash only after confirming, and a Trash card does not open", async () => {
    const { root, posted } = setup();
    tab(root, "trash").click();
    (root.querySelector(".catalog-row") as HTMLElement).click();
    root.querySelector<HTMLButtonElement>(".catalog-title")!.click();
    root.querySelector<HTMLButtonElement>(".catalog-menu")!.click();
    menuItem("Delete forever").click();
    await Promise.resolve();
    expect(posted).toEqual([{ type: "ready", view: "catalog" }]);
    await confirm();
    expect(posted.at(-1)).toEqual({ type: "deleteSpace", id: "d" });
    expect(posted).toHaveLength(2);
  });

  it("focuses the search on '/' until the catalog is disposed", () => {
    const { root, dispose } = setup();
    const input = root.querySelector<HTMLInputElement>("input.catalog-search")!;
    key(document.body, "/");
    expect(document.activeElement).toBe(input);
    input.blur();
    dispose();
    key(document.body, "/");
    expect(document.activeElement).not.toBe(input);
  });

  it("opens a row, its Papers count and its Projects count with the matching tab", () => {
    const { root, posted } = setup();
    (root.querySelector(".catalog-row") as HTMLElement).click();
    button(root, "2 papers").click();
    button(root, "1 project").click();
    expect(posted.slice(1)).toEqual([
      { type: "openSpace", id: "a", tab: "overview" },
      { type: "openSpace", id: "a", tab: "papers" },
      { type: "openSpace", id: "a", tab: "overview" },
    ]);
  });

  it("asks for a non-empty Space name before posting creation", async () => {
    const { root, posted } = setup();
    button(root, "New Space").click();
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    input.value = " "; input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(posted).toHaveLength(1);
    input.value = "  Research  "; input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    expect(posted.at(-1)).toEqual({ type: "createSpace", name: "Research" });
  });

});

describe("catalog errors and cleanup", () => {
  it("renders unreadable paths and failures as text without opening broken Spaces", () => {
    const { root, host, posted } = setup();
    host.post({ type: "catalog", rows: [{ ...row("broken", "broken", ""), unreadable: "<bad JSON>" }] });
    expect(root.textContent).toContain("spaces/broken/space.json");
    expect(root.textContent).toContain("<bad JSON>");
    expect(root.querySelector("bad")).toBeNull();
    expect(root.querySelector(".catalog-row button")).toBeNull();
    host.post({ type: "error", action: "Load catalog", message: "Disk unavailable" });
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("Disk unavailable");
    expect(posted).toHaveLength(1);
  });

  it("stops receiving messages after disposal", () => {
    const { root, host, dispose } = setup();
    dispose();
    host.post({ type: "catalog", rows: [] });
    expect(root.childElementCount).toBe(0);
  });
});

test("cancels Space creation when the catalog is disposed", async () => {
  const { root, dispose, posted } = setup();
  button(root, "New Space").click();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  dispose();
  await Promise.resolve();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(posted).toEqual([{ type: "ready", view: "catalog" }]);
});

it("shows the still-in-implementation toast from Share, which Trash hides", () => {
  const { root } = setup();
  const share = root.querySelector<HTMLButtonElement>('[data-act="share"]')!;
  expect(share.textContent).toBe("Share");
  share.click();
  expect([...document.querySelectorAll(".ls-toast .msg")].map((m) => m.textContent)).toContain("Still in implementation.");
  tab(root, "trash").click();
  expect(share.hidden).toBe(true);
});
