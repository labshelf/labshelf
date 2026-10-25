// Mounts the library sidebar over sample folders and papers and offers the DOM queries its tests share.
import type { ShareHost } from "../../../../src/libraryUi/share";
import { mountLibrarySidebar, type SidebarPaper, type SidebarProjectActions } from "../../../../src/libraryUi/dom";

export const paper = (id: string, folder: string, title: string, status: "unread" | "reading" | "done"): SidebarPaper =>
  ({ record: { id, title, status }, folder });

export const folders = [
  { name: "A", path: "papers/A", children: [{ name: "B", path: "papers/A/B", children: [] }] },
  { name: "Z", path: "papers/Z", children: [] },
];
export const papers = [
  paper("r1", "papers", "zeta root", "done"),
  paper("a1", "papers/A", "beta", "unread"),
  paper("a2", "papers/A", "Alpha", "done"),
  paper("b1", "papers/A/B", "deep", "reading"),
  paper("b2", "papers/A/B", "deeper", "reading"),
];
export const tagged = [
  { record: { id: "t1", title: "one", status: "done" as const, tags: ["NLP", "Deep learning"] }, folder: "papers" },
  { record: { id: "t2", title: "two", status: "unread" as const, tags: ["nlp"] }, folder: "papers" },
];

export function mount(expanded: string[] = [], collapsed: string[] = [], withProjects = false, withAddFiles = false, sharing?: ShareHost) {
  const actions = { ...(withAddFiles ? { addFiles: jest.fn() } : {}), openFolder: jest.fn(), revealPaper: jest.fn(), createFolder: jest.fn(), renameFolder: jest.fn(), removeFolder: jest.fn(), searchTag: jest.fn() };
  const saveExpanded = jest.fn();
  const saveCollapsed = jest.fn();
  const projects = { open: jest.fn(), menu: jest.fn(), browseTemplates: jest.fn(), allProjects: jest.fn(), newBlank: jest.fn(), addExisting: jest.fn() } as unknown as SidebarProjectActions & Record<string, jest.Mock>;
  const slot = document.createElement("div");
  document.body.replaceChildren(slot);
  const sidebar = mountLibrarySidebar(slot, { actions, expanded, saveExpanded, collapsed, saveCollapsed, ...(withProjects ? { projects } : {}), ...(sharing ? { sharing } : {}) });
  sidebar.setLibrary(folders, papers);
  return { slot, sidebar, actions, saveExpanded, saveCollapsed, projects };
}

export const rows = (slot: HTMLElement): HTMLElement[] => [...slot.querySelectorAll<HTMLElement>(".tree-row")];
export const compact = (el: Element | null): string => (el?.textContent ?? "").replace(/\s+/g, "");
export const folder = (slot: HTMLElement, path: string): HTMLElement => slot.querySelector<HTMLElement>(`[data-path="${path}"]`)!;
export const key = (slot: HTMLElement, k: string): void => { slot.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); };
