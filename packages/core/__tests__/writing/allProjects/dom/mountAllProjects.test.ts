/**
 * @jest-environment jsdom
 */
// Tests the All projects page's frame: list, header, and the selection it reports to the host.
import type { PanePrefs } from "../../../../src/libraryUi/store/index";
import { mountAllProjects } from "../../../../src/writing/allProjects/dom/index";
import type { AllProjectsToHost, HostToAllProjects } from "../../../../src/writing/allProjects/protocol";
import { row } from "./detailPane/fixtures";
import { fakeHost, tick } from "../../../collab/dom/fakeHost";
import type { ShareHost } from "../../../../src/share/index";

function mountPage(sharing?: ShareHost, withDetail = false) {
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
  mountAllProjects(root, { transport, prefs, sharing, withDetail });
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

describe("Share", () => {
  const share = (frame: HTMLElement) => frame.querySelector<HTMLButtonElement>('.list-header [data-act="share"]')!;

  it("is disabled until a project is selected, then opens the project share dialog for it", async () => {
    const host = fakeHost({ projects: jest.fn(async () => [{ id: row.id, name: "Attention", shared: false }]) });
    const t = mountPage(host);
    t.deliver({ type: "projects", rows: [row], commands: [], newKinds: ["blank"], openLabel: "Open" });
    expect(share(t.frame).disabled).toBe(true);
    expect(share(t.frame).title).toBe("Select a project to share");
    t.frame.querySelector<HTMLElement>(`.paper-row[data-id="${row.id}"] .paper-row-main`)!.click();
    expect(share(t.frame).disabled).toBe(false);
    share(t.frame).click();
    await tick();
    expect(host.projectStatus).toHaveBeenCalledWith(row.id);
  });

  it("stays disabled when sharing is not offered, and is hidden in Trash", () => {
    const t = mountPage(fakeHost({ offers: jest.fn(() => ({ projects: false, links: false })) }));
    t.deliver({ type: "projects", rows: [row], commands: [], newKinds: ["blank"], openLabel: "Open" });
    t.frame.querySelector<HTMLElement>(`.paper-row[data-id="${row.id}"] .paper-row-main`)!.click();
    expect(share(t.frame).disabled).toBe(true);
    t.frame.querySelector<HTMLElement>('.ls-place-tabs [data-place="trash"]')!.click();
    expect(share(t.frame).hidden).toBe(true);
  });

  it("is disabled without a sharing host", () => {
    const t = mountPage();
    t.deliver({ type: "projects", rows: [row], commands: [], newKinds: ["blank"], openLabel: "Open" });
    t.frame.querySelector<HTMLElement>(`.paper-row[data-id="${row.id}"] .paper-row-main`)!.click();
    expect(share(t.frame).disabled).toBe(true);
  });
});

it("has no detail pane unless the host asks for one", () => {
  const t = mountPage();
  expect(t.frame.querySelector(".ls-tab-details")).toBeNull();
  expect(t.frame.querySelector(".detail-toggle")).toBeNull();
});

it("shows the selected project in the detail pane and asks the host for its detail", () => {
  const t = mountPage(undefined, true);
  t.deliver({ type: "projects", rows: [row], commands: [], newKinds: ["blank"], openLabel: "Open in VS Code" });
  const pane = t.frame.querySelector<HTMLElement>(".ls-library > .ls-tab-details > .detail-pane")!;
  expect(pane.textContent).toContain("Select a project to see its details.");
  t.frame.querySelector<HTMLElement>(`.paper-row[data-id="${row.id}"] .paper-row-main`)!.click();
  expect(pane.querySelector(".detail-title")?.textContent).toBe(row.title);
  expect(pane.querySelector('[data-action="open"]')?.textContent).toBe("Open in VS Code");
  expect(t.sent).toContainEqual(expect.objectContaining({ type: "detail", id: row.id }));
});
