/**
 * @jest-environment jsdom
 */
// Tests the All projects page's frame: the detail pane follows the selection and the header toggle folds it through the prefs port.
import type { PanePrefs } from "../../../../src/library-ui/state/index";
import { mountAllProjects } from "../../../../src/writing/allProjects/dom/index";
import type { AllProjectsToHost, HostToAllProjects } from "../../../../src/writing/allProjects/protocol/index";
import { detail, row } from "./detail/fixtures";

function mountPage() {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  document.body.append(root);
  const sent: AllProjectsToHost[] = [];
  const saved: Partial<PanePrefs>[] = [];
  const handlers = new Set<(m: HostToAllProjects) => void>();
  const prefs = {
    load: (): PanePrefs => ({ detailWidth: 320, detailCollapsed: false, sidebarWidth: 240, sidebarCollapsed: false }),
    save: (patch: Partial<PanePrefs>): void => { saved.push(patch); },
  };
  const transport = {
    post: (m: AllProjectsToHost): void => { sent.push(m); },
    subscribe: (h: (m: HostToAllProjects) => void) => { handlers.add(h); return () => { handlers.delete(h); }; },
  };
  mountAllProjects(root, { transport, prefs });
  const frame = root.firstElementChild as HTMLElement;
  return { root, frame, sent, saved, deliver: (m: HostToAllProjects): void => { for (const h of [...handlers]) h(m); } };
}

it("builds the frame with the Library and All projects classes, the list and the detail pane", () => {
  const t = mountPage();
  expect(t.frame.classList.contains("ls-library")).toBe(true);
  expect(t.frame.classList.contains("ls-all-projects")).toBe(true);
  expect(t.frame.querySelector(".list-pane > .list-header .ls-place-tabs")).not.toBeNull();
  expect(t.frame.querySelector(".list-pane > .list-body")).not.toBeNull();
  expect(t.frame.querySelector('aside.detail-pane[aria-label="Project details"] .muted-note')?.textContent).toBe("Select a project to see its details.");
  expect(t.sent).toEqual([{ type: "ready" }, { type: "project.selected", id: null }]);
});

it("reports each selection change once, including a selection cleared by a place change", () => {
  const t = mountPage();
  t.deliver({ type: "projects", rows: [row], commands: [], newKinds: ["blank", "template", "folder"], openLabel: "Open" });
  const selected = () => t.sent.filter((m) => m.type === "project.selected");
  const rowMain = () => t.frame.querySelector<HTMLElement>(`.paper-row[data-id="${row.id}"] .paper-row-main`)!;
  rowMain().click();
  rowMain().click();
  t.frame.querySelector<HTMLElement>('.ls-place-tabs [data-place="archived"]')!.click();
  expect(selected()).toEqual([
    { type: "project.selected", id: null },
    { type: "project.selected", id: row.id },
    { type: "project.selected", id: null },
  ]);
});

it("shows the selected project's title in the pane and fills it when the detail arrives", () => {
  const t = mountPage();
  t.deliver({ type: "projects", rows: [row], commands: [], newKinds: ["blank", "template", "folder"], openLabel: "Open in VS Code" });
  t.frame.querySelector<HTMLElement>(`.paper-row[data-id="${row.id}"] .paper-row-main`)!.click();
  expect(t.sent).toContainEqual({ type: "detail", id: row.id });
  const pane = t.frame.querySelector(".detail-pane")!;
  expect(pane.querySelector(".detail-title")?.textContent).toBe(row.title);
  expect(pane.querySelector(".open-btn")?.textContent).toContain("Open in VS Code");
  expect(pane.querySelector(".pane-loading")).not.toBeNull();
  t.deliver({ type: "detail", id: row.id, detail });
  expect(pane.querySelector(".pane-loading")).toBeNull();
  expect(pane.querySelector(".tab-body .detail-section")).not.toBeNull();
});

it("folds the detail pane from the header toggle and saves that", () => {
  const t = mountPage();
  const toggle = t.frame.querySelector<HTMLElement>('.list-header .ls-icon-btn[data-act="detail"]')!;
  toggle.click();
  expect(t.frame.classList.contains("detail-collapsed")).toBe(true);
  expect(t.saved).toEqual([{ detailCollapsed: true }]);
  toggle.click();
  expect(t.frame.classList.contains("detail-collapsed")).toBe(false);
  expect(t.saved).toEqual([{ detailCollapsed: true }, { detailCollapsed: false }]);
});

it("offers only the new-project kinds the host can create", () => {
  const t = mountPage();
  t.deliver({ type: "projects", rows: [row], commands: [], newKinds: ["blank"], openLabel: "Open" });
  t.frame.querySelector<HTMLElement>('.list-header [data-act="new"]')!.click();
  expect([...document.querySelectorAll(".ls-menu-label")].map((l) => l.textContent)).toEqual(["Blank project"]);
});
