/**
 * @jest-environment jsdom
 */
// Tests the project detail pane: its empty, loading and error states, tab and fold memory across updates, and the actions it posts.
import { mountProjectDetail } from "../../../../../src/writing/allProjects/dom/detailPane/index";
import type { AllProjectsToHost } from "../../../../../src/writing/allProjects/protocol/index";
import { detail, row, NOW } from "./fixtures";
import { projectDetailHeadHtml } from "../../../../../src/writing/allProjects/dom/detailPane/mountProjectDetailPane";

function mount() {
  document.body.innerHTML = "";
  const slot = document.createElement("aside");
  document.body.append(slot);
  const sent: AllProjectsToHost[] = [];
  const post = (m: AllProjectsToHost): void => { sent.push(m); };
  const pane = mountProjectDetail(slot, { post, menu: () => ({ rows: [row], commands: [], post }) });
  const show = (d: typeof detail | null = detail, error?: string): void => pane.update({ row, detail: d ?? undefined, error, openLabel: "Open in VS Code" });
  return { slot, sent, pane, show };
}
type T = ReturnType<typeof mount>;
const click = (t: T, selector: string): void => t.slot.querySelector<HTMLElement>(selector)!.click();
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const quickInput = (): HTMLInputElement => document.querySelector<HTMLInputElement>(".ls-quick input")!;
const pressOn = (el: Element, key: string): void => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); };
const submit = async (value: string): Promise<void> => { const input = quickInput(); input.value = value; pressOn(input, "Enter"); await tick(); };

describe("states", () => {
  it("asks for a selection when no row is selected", () => {
    const t = mount();
    expect(t.slot.querySelector(".muted-note")?.textContent).toBe("Select a project to see its details.");
    t.pane.update({ row: undefined, detail: undefined, error: undefined, openLabel: "Open" });
    expect(t.slot.querySelector(".detail-head")).toBeNull();
  });

  it("shows the head and tabs with a loading body while the detail is on its way", () => {
    const t = mount();
    t.show(null);
    expect(t.slot.querySelector(".detail-title")?.textContent).toBe("Attention <is> all");
    expect(t.slot.querySelector(".open-btn")?.textContent).toContain("Open in VS Code");
    expect(t.slot.querySelectorAll('.detail-tabs [data-action="tab"]')).toHaveLength(3);
    expect(t.slot.querySelector(".tab-body .pane-loading")).not.toBeNull();
  });

  it("shows a detail error muted in place of the tab body", () => {
    const t = mount();
    t.show(null, "No such project");
    expect(t.slot.querySelector(".detail-title")).not.toBeNull();
    expect(t.slot.querySelector(".tab-body .muted-note")?.textContent).toBe("No such project");
    expect(t.slot.querySelector(".pane-loading")).toBeNull();
  });
});

describe("tabs and folds", () => {
  it("switches the body on a tab click and keeps the tab across an update", () => {
    const t = mount();
    t.show();
    expect(t.slot.querySelector(".tab-body .detail-section")).not.toBeNull();
    click(t, '[data-action="tab"][data-tab="citations"]');
    expect(t.slot.querySelector(".tab-body .ls-cite-list")).not.toBeNull();
    expect(t.slot.querySelector(".tab-body .detail-section")).toBeNull();
    t.show();
    expect(t.slot.querySelector(".tab-body .ls-cite-list")).not.toBeNull();
    click(t, '[data-action="tab"][data-tab="versions"]');
    expect(t.slot.querySelector(".tab-body .ls-version-list")).not.toBeNull();
  });

  it("folds a section on click and keeps the fold across an update", () => {
    const t = mount();
    t.show();
    const head = t.slot.querySelector<HTMLElement>('.sec-head[aria-expanded="true"]')!;
    const sec = head.dataset["sec"]!;
    head.click();
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(t.slot.querySelector(`[data-sec-body="${sec}"]`)?.classList.contains("hidden")).toBe(true);
    t.show();
    expect(t.slot.querySelector(`.sec-head[data-sec="${sec}"]`)?.getAttribute("aria-expanded")).toBe("false");
    expect(t.slot.querySelector(`[data-sec-body="${sec}"]`)?.classList.contains("hidden")).toBe(true);
  });

  it("opens the folded-by-default Location with Enter and keeps it open", () => {
    const t = mount();
    t.show();
    const head = t.slot.querySelector<HTMLElement>('.sec-head[data-sec="location"]')!;
    expect(head.getAttribute("aria-expanded")).toBe("false");
    pressOn(head, "Enter");
    expect(head.getAttribute("aria-expanded")).toBe("true");
    t.show();
    expect(t.slot.querySelector('.sec-head[data-sec="location"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(t.slot.querySelector('[data-sec-body="location"]')?.classList.contains("hidden")).toBe(false);
  });
});

describe("actions", () => {
  it.each(["open", "build", "openLog"] as const)("posts %s with the project id", (type) => {
    const t = mount();
    t.show();
    click(t, `[data-action="${type}"]`);
    expect(t.sent).toEqual([{ type, id: row.id }]);
  });

  it("edits the venue then the deadline and posts setTarget", async () => {
    const t = mount();
    t.show();
    click(t, '[data-action="editTarget"]');
    expect(quickInput().value).toBe("ICLR 2027");
    await submit("NeurIPS 2027");
    expect(quickInput().value).toBe("2026-11-27");
    await submit("2027-05-15");
    expect(t.sent).toEqual([{ type: "setTarget", id: row.id, venue: "NeurIPS 2027", deadline: "2027-05-15" }]);
    expect(document.querySelector(".ls-quick")).toBeNull();
  });

  it("clears the target when both boxes are left empty", async () => {
    const t = mount();
    t.show();
    click(t, '[data-action="editTarget"]');
    await submit("");
    await submit("");
    expect(t.sent).toEqual([{ type: "setTarget", id: row.id }]);
  });

  it("keeps the deadline box open on a malformed or impossible date", async () => {
    const t = mount();
    t.show();
    click(t, '[data-action="editTarget"]');
    await submit("ICLR 2027");
    await submit("15/05/2027");
    expect(quickInput().getAttribute("aria-invalid")).toBe("true");
    await submit("2027-13-45");
    expect(quickInput().getAttribute("aria-invalid")).toBe("true");
    expect(t.sent).toEqual([]);
  });

  it("posts nothing when the deadline box is cancelled", async () => {
    const t = mount();
    t.show();
    click(t, '[data-action="editTarget"]');
    await submit("ICLR 2027");
    pressOn(quickInput(), "Escape");
    await tick();
    expect(document.querySelector(".ls-quick")).toBeNull();
    expect(t.sent).toEqual([]);
  });
});

const render = (html: string): HTMLElement => { const el = document.createElement("div"); el.innerHTML = html; return el; };

describe("projectDetailHeadHtml", () => {
  const head = render(projectDetailHeadHtml(row, detail, { openLabel: "Open in VS Code", now: NOW }));

  it("escapes the title and shows the meta line", () => {
    expect(head.querySelector(".detail-title")?.textContent).toBe("Attention <is> all");
    expect(head.innerHTML).not.toContain("<is>");
    expect(head.querySelector(".detail-meta")?.textContent).toBe("LaTeX · main.tex · 8 pages · modified 2 h ago");
  });

  it("offers the more menu, the open button with the host's label and Preview", () => {
    expect(head.querySelector(".head-more [data-action=more]")).not.toBeNull();
    expect(head.querySelector(".detail-toolbar .open-btn[data-action=open]")?.textContent).toBe("Open in VS Code");
    expect(head.querySelector(".detail-toolbar [data-action=preview]")?.textContent).toBe("Preview");
  });

  it("shows the build dot with its status and the target with the days left", () => {
    const status = head.querySelector(".detail-status-row")!;
    expect(status.querySelector(".ls-build-dot")?.className).toContain("b-warnings");
    expect(status.textContent).toContain("2 warnings");
    expect(status.querySelector("svg")).not.toBeNull();
    expect(status.textContent).toContain("ICLR 2027 · 41 d");
  });

  it("drops the target without a venue or deadline and reads the status from the row before the detail arrives", () => {
    const bare = render(projectDetailHeadHtml({ id: "x", title: "t", place: "projects", build: { state: "ok" } }, undefined, { openLabel: "Open", now: NOW }));
    expect(bare.querySelector(".detail-status-row svg")).toBeNull();
    expect(bare.querySelector(".detail-status-row")?.textContent).toBe("Built");
  });
});
