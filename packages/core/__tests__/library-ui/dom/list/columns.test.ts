/**
 * @jest-environment jsdom
 */
// Tests the columns menu: it lists the optional columns, shows and hides them in heads and rows, and falls back to Title when the sorted one hides.
import { menuLabels, mountForTest, paper } from "../mountHarness";

const library = [paper("a", "papers", { title: "Alpha", journal: "Nature" })];
const item = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>(".ls-menu-item")].find((b) => b.querySelector(".ls-menu-label")?.textContent === label)!;
const headsMenu = (t: ReturnType<typeof mountForTest>): void => {
  t.container.querySelector(".col-heads")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
};

describe("columns menu", () => {
  it("lists the five optional columns, checked when shown, on a right-click of the heads", () => {
    const t = mountForTest();
    t.snapshot(library);
    headsMenu(t);
    expect(menuLabels()).toEqual(["Authors", "Venue", "Year", "Last read", "Status"]);
    expect(item("Authors").classList.contains("checked")).toBe(true);
    expect(item("Venue").classList.contains("checked")).toBe(false);
    expect(item("Last read").classList.contains("checked")).toBe(false);
  });

  it("opens from the Columns button too", () => {
    const t = mountForTest();
    t.snapshot(library);
    t.click(".col-menu button");
    expect(menuLabels()).toHaveLength(5);
  });

  it("adds the Venue head and cells, saves the columns, and removes them when toggled again", () => {
    const t = mountForTest();
    t.snapshot(library);
    expect(t.container.querySelector(".col-venue")).toBeNull();
    headsMenu(t);
    item("Venue").click();
    expect(t.saved.at(-1)).toEqual({ columns: ["creator", "venue", "year", "status"] });
    expect(t.container.querySelector(".col-head.col-venue")).not.toBeNull();
    expect(t.container.querySelector(".paper-row-main .col-venue")?.textContent).toBe("Nature");
    headsMenu(t);
    item("Venue").click();
    expect(t.saved.at(-1)).toEqual({ columns: ["creator", "year", "status"] });
    expect(t.container.querySelector(".col-venue")).toBeNull();
  });

  it("sets the hidden track to zero and clears it when the column returns", () => {
    const t = mountForTest();
    t.snapshot(library);
    const list = t.container.querySelector<HTMLElement>(".paper-list")!;
    expect(list.style.getPropertyValue("--w-venue")).toBe("0px");
    headsMenu(t);
    item("Venue").click();
    expect(list.style.getPropertyValue("--w-venue")).toBe("");
  });

  it("sorts by Title again when the sorted column is hidden", () => {
    const t = mountForTest({ sortKey: "year", sortDir: -1 });
    t.snapshot(library);
    headsMenu(t);
    item("Year").click();
    expect(t.saved.at(-1)).toEqual({ columns: ["creator", "status"], sortKey: "title", sortDir: 1 });
    expect(t.lib.store.get().sortKey).toBe("title");
  });

  it("keeps sorting by the heads after they are rebuilt", () => {
    const t = mountForTest();
    t.snapshot(library);
    headsMenu(t);
    item("Venue").click();
    t.click(".col-head.col-venue");
    expect(t.lib.store.get().sortKey).toBe("venue");
  });
});
