/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// The browser sidebar lists the library's projects under Projects, opens one in the editor page and offers only what the browser can do.
import { LibraryViewStore } from "@labshelf/core";
import type { LibraryUi } from "@labshelf/core/dom";
import type { PagePrefs } from "../../../src/library-page/prefs";
import type { BrowserProjectRow, ProjectsSource } from "../../../src/library-page/projects";
import { mountSidebarTree } from "../../../src/library-page/sidebar/sidebarTree";

const ready: BrowserProjectRow = { id: "projects/thesis", name: "Thesis", format: "latex", tooltip: "thesis", kind: "ready", external: false, projectId: "thesis", pdf: "main.pdf" };
const broken: BrowserProjectRow = { id: "projects/gone", name: "gone", count: "missing", tooltip: "gone", kind: "broken", external: false };

async function mount(rows: BrowserProjectRow[] = [ready, broken]) {
  const store = new LibraryViewStore({ folders: [], papers: [], loading: false });
  const prefs = { treeExpanded: () => [], saveTreeExpanded: jest.fn(), collapsedSections: () => [], saveCollapsedSections: jest.fn() } as unknown as PagePrefs;
  const ui = { sidebar: null, store, folders: { create: jest.fn(), rename: jest.fn(), remove: jest.fn() }, dropTarget: jest.fn(), dispose: jest.fn() } as unknown as LibraryUi;
  const source = { rows: jest.fn(async () => rows), openEditor: jest.fn(), openPdf: jest.fn() } satisfies ProjectsSource;
  const slot = document.createElement("div");
  document.body.replaceChildren(slot);
  mountSidebarTree(ui, slot, prefs, { post: jest.fn() }, source);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { slot, source };
}

const projectRow = (slot: HTMLElement, id: string): HTMLElement => slot.querySelector<HTMLElement>(`[data-project="${id}"]`)!;
const menuLabels = (): string[] => [...document.querySelectorAll(".ls-menu .ls-menu-label")].map((label) => label.textContent ?? "");

describe("sidebar projects glue", () => {
  it("shows the brand, Library and Projects, without a citation map entry", async () => {
    const { slot } = await mount();
    expect(slot.querySelector(".ls-brand")?.textContent).toBe("LabShelf");
    expect(slot.querySelector('[data-section="library"]')).not.toBeNull();
    expect(slot.querySelector('[data-section="projects"]')).not.toBeNull();
    expect(slot.textContent).not.toContain("Citation map");
  });

  it("lists the projects and hides what the browser cannot do", async () => {
    const { slot } = await mount();
    expect(projectRow(slot, "projects/thesis").textContent).toContain("Thesis");
    expect(slot.querySelector("[data-templates]")).toBeNull();
    expect(slot.querySelector("[data-all-projects]")).toBeNull();
    expect(slot.querySelector('[data-tree="blank"]')).toBeNull();
    expect(slot.querySelector('[data-tree="project-folder"]')).toBeNull();
  });

  it("opens a ready project in the editor page by its project id", async () => {
    const { slot, source } = await mount();
    projectRow(slot, "projects/thesis").click();
    expect(source.openEditor).toHaveBeenCalledWith("thesis");
    projectRow(slot, "projects/gone").click();
    expect(source.openEditor).toHaveBeenCalledTimes(1);
  });

  it("offers Open in Editor and Open PDF on a built project's menu", async () => {
    const { slot, source } = await mount();
    projectRow(slot, "projects/thesis").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(menuLabels()).toEqual(["Open in Editor", "Open PDF"]);
    document.querySelectorAll<HTMLElement>(".ls-menu [role=menuitem]")[1]!.click();
    expect(source.openPdf).toHaveBeenCalledWith("thesis", "main.pdf");
  });

  it("lists the projects again on Refresh", async () => {
    const { slot, source } = await mount();
    slot.querySelector<HTMLElement>('[data-tree="project-refresh"]')!.click();
    expect(source.rows).toHaveBeenCalledTimes(2);
  });
});
