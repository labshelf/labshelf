/**
 * @jest-environment jsdom
 */
// Tests the Invitations block above the All projects list: its visibility, the opt-in toggle, the rows with Accept and Decline, and the refresh on change.
import type { PanePrefs } from "../../../../src/libraryUi/store/index";
import type { InvitationView, JoinProjectResult, ShareHost } from "../../../../src/share/index";
import { mountAllProjects } from "../../../../src/writing/allProjects/dom/index";
import type { AllProjectsToHost, HostToAllProjects } from "../../../../src/writing/allProjects/protocol";
import { clickButton, fakeHost, tick } from "../../../collab/dom/fakeHost";

function mountPage(sharing?: ShareHost): HTMLElement {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  document.body.append(root);
  const prefs = { load: (): PanePrefs => ({ sidebarWidth: 240, sidebarCollapsed: false }), save: (): void => {} };
  const transport = { post: (_m: AllProjectsToHost): void => {}, subscribe: (_h: (m: HostToAllProjects) => void) => (): void => {} };
  mountAllProjects(root, { transport, prefs, sharing });
  return root;
}

const flush = async (): Promise<void> => { for (let i = 0; i < 4; i++) await tick(); };

const invitation = (over: Partial<InvitationView> = {}): InvitationView =>
  ({ id: "i1", title: "Thesis", from: { name: "Alice", email: "alice@example.org", fingerprint: "f1" }, created: 1, expires: 2, ...over });
const fromBob = invitation({ id: "i2", title: "Paper", from: { email: "bob@example.org", fingerprint: "f2" } });

const block = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>(".ls-invitations");
const rows = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(".ls-invitation-row")];
const toggle = (root: HTMLElement): HTMLInputElement => root.querySelector<HTMLInputElement>('.ls-invitations input[type="checkbox"]')!;
const textOf = (row: HTMLElement, selector: string): string | null => row.querySelector(selector)!.textContent;

afterEach(() => { document.body.innerHTML = ""; });

describe("Invitations block", () => {
  it("is absent without sharing", () => {
    expect(block(mountPage())).toBeNull();
  });

  it("sits above the list and follows the host's project offers", async () => {
    let onOffers: () => void = () => {};
    const offers = { projects: false, links: true };
    const host = fakeHost({ offers: jest.fn(() => offers), onOffersChange: jest.fn((listener) => { onOffers = listener; return () => {}; }) });
    const root = mountPage(host);
    const el = block(root)!;
    expect(el.nextElementSibling?.classList.contains("list-body")).toBe(true);
    expect(el.hidden).toBe(true);
    offers.projects = true;
    onOffers();
    await flush();
    expect(el.hidden).toBe(false);
    expect(el.textContent).toContain("Receive invitations by email");
  });

  it("lists each invitation with its project, sender and Accept/Decline, and refreshes on change", async () => {
    let onChange: (list: InvitationView[]) => void = () => {};
    const host = fakeHost({
      invitationsEnabled: jest.fn(async () => true),
      invitations: jest.fn(async () => [invitation(), fromBob]),
      onInvitationsChange: jest.fn((listener) => { onChange = listener; return () => {}; }),
    });
    const root = mountPage(host);
    await flush();
    const shown = rows(root);
    expect(shown.map((r) => textOf(r, ".ls-invitation-title"))).toEqual(["Thesis", "Paper"]);
    expect(shown.map((r) => textOf(r, ".ls-invitation-from"))).toEqual(["Alice", "bob@example.org"]);
    expect([...shown[0]!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Accept", "Decline"]);
    onChange([fromBob]);
    expect(rows(root).map((r) => textOf(r, ".ls-invitation-title"))).toEqual(["Paper"]);
    onChange([]);
    expect(rows(root)).toEqual([]);
  });

  it("shows no rows while invitations are off, whatever the host holds", async () => {
    const host = fakeHost({ invitations: jest.fn(async () => [invitation()]) });
    const root = mountPage(host);
    await flush();
    expect(rows(root)).toEqual([]);
    expect(toggle(root).checked).toBe(false);
  });

  it("Accept calls acceptInvitation with the id and keeps both buttons disabled while it runs", async () => {
    let settle!: (result: JoinProjectResult) => void;
    const host = fakeHost({
      invitationsEnabled: jest.fn(async () => true),
      invitations: jest.fn(async () => [invitation()]),
      acceptInvitation: jest.fn(() => new Promise<JoinProjectResult>((resolve) => { settle = resolve; })),
    });
    const root = mountPage(host);
    await flush();
    const [accept, decline] = [...rows(root)[0]!.querySelectorAll("button")];
    accept!.click();
    expect(host.acceptInvitation).toHaveBeenCalledWith("i1", expect.any(AbortSignal));
    expect(accept!.disabled).toBe(true);
    expect(decline!.disabled).toBe(true);
    settle({ kind: "refused", problem: "This invitation has expired." });
    await flush();
    expect(document.body.textContent).toContain("This invitation has expired.");
    // The row stays busy until the refusal notice is dismissed.
    expect(accept!.disabled).toBe(true);
    clickButton("OK");
    await flush();
    expect(rows(root)[0]!.querySelector("button")!.disabled).toBe(false);
  });

  it("Decline calls declineInvitation with the id", async () => {
    const host = fakeHost({ invitationsEnabled: jest.fn(async () => true), invitations: jest.fn(async () => [invitation()]) });
    const root = mountPage(host);
    await flush();
    [...rows(root)[0]!.querySelectorAll("button")].find((b) => b.textContent === "Decline")!.click();
    expect(host.declineInvitation).toHaveBeenCalledWith("i1");
  });

  it("the toggle turns invitations on and off through the host and re-reads the setting", async () => {
    let enabled = false;
    const host = fakeHost({
      invitationsEnabled: jest.fn(async () => enabled),
      setInvitationsEnabled: jest.fn(async (on: boolean) => { enabled = on; }),
    });
    const root = mountPage(host);
    await flush();
    const box = toggle(root);
    expect(box.checked).toBe(false);
    box.click();
    await flush();
    expect(host.setInvitationsEnabled).toHaveBeenCalledWith(true);
    expect(box.checked).toBe(true);
    box.click();
    await flush();
    expect(host.setInvitationsEnabled).toHaveBeenLastCalledWith(false);
    expect(box.checked).toBe(false);
  });

  it("keeps the toggle off and shows the host's message when turning invitations on fails", async () => {
    const host = fakeHost({ setInvitationsEnabled: jest.fn(async () => { throw new Error("Connect Cloudflare first"); }) });
    const root = mountPage(host);
    await flush();
    toggle(root).click();
    await flush();
    expect(toggle(root).checked).toBe(false);
    expect(document.body.textContent).toContain("Connect Cloudflare first");
  });
});
