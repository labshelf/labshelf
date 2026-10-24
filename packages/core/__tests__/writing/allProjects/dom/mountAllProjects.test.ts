/**
 * @jest-environment jsdom
 */
// Tests the All projects page's frame: list, header, and the selection it reports to the host.
import type { PanePrefs } from "../../../../src/libraryUi/state/index";
import { mountAllProjects } from "../../../../src/writing/allProjects/dom/index";
import type { AllProjectsToHost, HostToAllProjects } from "../../../../src/writing/allProjects/protocol/index";
import { row } from "./detail/fixtures";

function mountPage() {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  document.body.append(root);
  const sent: AllProjectsToHost[] = [];
  const saved: Partial<PanePrefs>[] = [];
  const handlers = new Set<(m: HostToAllProjects) => void>();
  const prefs = {
    load: (): PanePrefs => ({ sidebarWidth: 240, sidebarCollapsed: false }),
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

it("builds the frame with the Library and All projects classes and the list", () => {
  const t = mountPage();
  expect(t.frame.classList.contains("ls-library")).toBe(true);
  expect(t.frame.classList.contains("ls-all-projects")).toBe(true);
  expect(t.frame.querySelector(".list-pane > .list-header .ls-place-tabs")).not.toBeNull();
  expect(t.frame.querySelector(".list-pane > .list-body")).not.toBeNull();
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

it("offers only the new-project kinds the host can create", () => {
  const t = mountPage();
  t.deliver({ type: "projects", rows: [row], commands: [], newKinds: ["blank"], openLabel: "Open" });
  t.frame.querySelector<HTMLElement>('.list-header [data-act="new"]')!.click();
  expect([...document.querySelectorAll(".ls-menu-label")].map((l) => l.textContent)).toEqual(["Blank project"]);
});
