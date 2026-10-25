/**
 * @jest-environment jsdom
 */
// Tests the Projects section of the library sidebar: rows, host menus and sharing entries.
import { fakeHost } from "../../../collab/dom/fakeHost";
import type { SharingHost } from "../../../../src/libraryUi/share";
import { compact, folder, key, mount, rows } from "./sidebarFixture";

const project = (id: string, group = "", count?: string) =>
  ({ id, name: `P ${id}`, format: "latex" as const, tooltip: `tip ${id}`, ...(group ? { folder: group } : {}), ...(count ? { count } : {}) });

describe("mountLibrarySidebar projects", () => {
  it("renders project rows with mark, name and count, and opens one on click", () => {
    const { slot, sidebar, projects } = mount([], [], true);
    sidebar.setProjects([project("/a", "", "3"), project("/b")]);
    const row = slot.querySelector<HTMLElement>('[data-project="/a"]')!;
    expect(row.querySelector(".tree-ref")?.textContent).toBe("TEX");
    expect(row.querySelector(".tree-label")?.textContent).toBe("P /a");
    expect(row.querySelector(".tree-count")?.textContent).toBe("3");
    expect(row.getAttribute("title")).toBe("tip /a");
    expect(slot.querySelector('[data-project="/b"] .tree-count')).toBeNull();
    row.click();
    expect(projects.open).toHaveBeenCalledWith("/a");
  });

  it("opens the focused project with Enter", () => {
    const { slot, sidebar, projects } = mount([], ["library"], true);
    sidebar.setProjects([project("/a")]);
    for (let i = 0; i < 5; i++) { key(slot, "ArrowDown"); }
    key(slot, "Enter");
    expect(projects.open).toHaveBeenCalledWith("/a");
  });

  it("asks the host for its menu on right-click, with the pointer position", () => {
    const { slot, sidebar, projects } = mount([], [], true);
    sidebar.setProjects([project("/a")]);
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 34 });
    slot.querySelector('[data-project="/a"]')!.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(projects.menu).toHaveBeenCalledWith("/a", { x: 12, y: 34 });
  });

  it.each([
    ["Shift+F10", { key: "F10", shiftKey: true }],
    ["ContextMenu", { key: "ContextMenu" }],
  ])("opens the focused project's host menu at the row on %s", (_name, init) => {
    const { slot, sidebar, projects } = mount([], ["library"], true);
    sidebar.setProjects([project("/a")]);
    for (let i = 0; i < 5; i++) { key(slot, "ArrowDown"); }
    const row = slot.querySelector<HTMLElement>('[data-project="/a"]')!;
    row.getBoundingClientRect = () => ({ left: 7, bottom: 21 }) as DOMRect;
    const e = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
    slot.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(projects.menu).toHaveBeenCalledWith("/a", { x: 7, y: 21 });
  });

  const projectsMenu = (sharing?: SharingHost): string => {
    const { slot, sidebar } = mount([], [], true, false, sharing);
    sidebar.setProjects([project("/a")]);
    slot.querySelector('[data-group="projects.list"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    return document.body.textContent ?? "";
  };

  it("offers Join Shared Project in the menu and as a button only when the host offers projects", () => {
    expect(projectsMenu(fakeHost())).toContain("Join Shared Project");
    expect(projectsMenu(fakeHost({ offers: () => ({ projects: false, links: true }) }))).not.toContain("Join Shared Project");
    expect(projectsMenu()).not.toContain("Join Shared Project");
    const on = mount([], [], true, false, fakeHost());
    expect(on.slot.querySelector('[data-tree="join"]')).not.toBeNull();
    const off = mount([], [], true, false, fakeHost({ offers: () => ({ projects: false, links: false }) }));
    expect(off.slot.querySelector('[data-tree="join"]')).toBeNull();
  });

  it("leaves Enter and Space on a heading button to the browser instead of activating the focused row", () => {
    const { slot, sidebar, projects } = mount([], ["library"], true, false, fakeHost());
    sidebar.setProjects([project("/a")]);
    for (let i = 0; i < 5; i++) { key(slot, "ArrowDown"); }
    const join = slot.querySelector<HTMLElement>('[data-tree="join"]')!;
    for (const k of ["Enter", " "]) {
      const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
      join.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
    }
    expect(projects.open).not.toHaveBeenCalled();
  });

  it("re-renders when the host's offers change", () => {
    let listener = (): void => {};
    let projectsOn = false;
    const host = fakeHost({ offers: () => ({ projects: projectsOn, links: false }), onOffersChange: (l) => { listener = l; return () => {}; } });
    const { slot } = mount([], [], true, false, host);
    expect(slot.querySelector('[data-tree="join"]')).toBeNull();
    projectsOn = true;
    listener();
    expect(slot.querySelector('[data-tree="join"]')).not.toBeNull();
  });

  it("nests projects under their folder row, folders first, and shows them only while the folder is expanded", () => {
    const list = [project("/a", "Thesis"), project("/b"), project("/c", "Thesis")];
    const closed = mount([], [], true);
    closed.sidebar.setProjects(list);
    expect([...closed.slot.querySelectorAll<HTMLElement>("[data-project-folder]")].map((r) => compact(r))).toEqual(["Thesis2"]);
    expect(rows(closed.slot).map((r) => r.dataset["project"]).filter(Boolean)).toEqual(["/b"]);
    const open = mount(["project-folder:Thesis"], [], true);
    open.sidebar.setProjects(list);
    expect(rows(open.slot).map((r) => r.dataset["project"]).filter(Boolean)).toEqual(["/a", "/c", "/b"]);
  });

  it("opens the All projects tab from its row under Explore templates, and keeps archived projects out of the tree", () => {
    const { slot, sidebar, projects } = mount([], [], true);
    sidebar.setProjects([project("/a"), { ...project("/b"), hidden: true }]);
    const keys = [...slot.querySelectorAll<HTMLElement>(".tree-row[data-key]")].map((r) => r.dataset["key"]);
    expect(keys.indexOf("allProjects")).toBe(keys.indexOf("templates") + 1);
    expect(slot.querySelector('[data-project="/b"]')).toBeNull();
    slot.querySelector<HTMLElement>("[data-all-projects]")!.click();
    expect(projects.allProjects).toHaveBeenCalledTimes(1);
  });

  it("leaves out the templates row and the buttons of actions the host cannot run", () => {
    const { slot, sidebar } = mount([], [], true);
    sidebar.setProjects([]);
    sidebar.setProjectOffers({ templates: false, addExisting: false });
    expect(slot.querySelector("[data-templates]")).toBeNull();
    expect(slot.querySelector('.tree-empty-actions [data-tree="browse"]')).toBeNull();
    expect(slot.querySelector('.tree-empty-actions [data-tree="add"]')).toBeNull();
    expect(slot.querySelector('.tree-empty-actions [data-tree="blank"]')).not.toBeNull();
  });

  it("leaves out creating projects, project folders and the All projects row for a host that has none of them", () => {
    const { slot, sidebar } = mount([], [], true);
    sidebar.setProjects([project("/a", "Thesis")]);
    sidebar.setProjectOffers({ templates: false, addExisting: false, newBlank: false, projectFolders: false, allProjects: false });
    expect(slot.querySelector("[data-all-projects]")).toBeNull();
    expect(slot.querySelector('[data-tree="blank"]')).toBeNull();
    expect(slot.querySelector('[data-tree="project-folder"]')).toBeNull();
    expect(slot.querySelector('[data-tree="project-refresh"]')).not.toBeNull();
    expect(slot.querySelector('[data-project-folder="Thesis"]')).not.toBeNull();
    for (const target of [slot.querySelector('[data-project-folder="Thesis"]')!, slot.querySelector('[data-group="projects.list"]')!]) {
      const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      target.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
    }
    sidebar.setProjects([]);
    expect(slot.querySelector(".tree-empty")?.textContent).toBe("No projects yet.");
    expect(slot.querySelector(".tree-empty-actions")).toBeNull();
  });

  it("shows an empty state whose buttons call the host actions", () => {
    const { slot, sidebar, projects } = mount([], [], true);
    expect(slot.querySelector(".tree-empty-actions")).not.toBeNull();
    sidebar.setProjects([]);
    const click = (a: string): void => slot.querySelector<HTMLElement>(`.tree-empty-actions [data-tree="${a}"]`)!.click();
    click("browse"); click("blank"); click("add");
    expect(projects.browseTemplates).toHaveBeenCalledTimes(1);
    expect(projects.newBlank).toHaveBeenCalledTimes(1);
    expect(projects.addExisting).toHaveBeenCalledTimes(1);
    expect(slot.textContent).toContain("No projects yet.");
  });

  it("opens the template gallery from the Explore templates row and creates a blank project from the list header", () => {
    const { slot, sidebar, projects } = mount([], [], true);
    sidebar.setProjects([project("/a")]);
    slot.querySelector<HTMLElement>("[data-templates]")!.click();
    slot.querySelector<HTMLElement>('[data-tree="blank"]')!.click();
    expect(projects.browseTemplates).toHaveBeenCalledTimes(1);
    expect(projects.newBlank).toHaveBeenCalledTimes(1);
  });
});
