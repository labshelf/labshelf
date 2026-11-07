/** @jest-environment jsdom */
// Pins Space presence in the Discussions tab: the open conversation and typing sent to the host, and the online members, typing line and row dots shown.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { mountSpaceDiscussions } from "../../../src/spaces/dom/mountSpaceDiscussions";
import { createConversationPresenceSender } from "../../../src/spaces/dom/discussionsPresence";
import type { SpaceSnapshot } from "../../../src/spaces/dom/mountOverview";
import type { HostToSpaces, SpacesToHost, SpacesTransport } from "../../../src/spaces/spacesProtocol";
import type { SpaceThreadEntry } from "../../../src/spaces/spaceDiscussionsStore";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });

const data = {
  type: "space", author: "Me",
  space: { id: "s", name: "S", folders: [], papers: [], projects: [], dates: [], extra: {}, invalid: { folders: [], papers: [], projects: [], dates: [] } },
  overview: { desk: [], projects: [], timeline: [] }, glossary: { terms: [] }, projects: [], papers: { folders: [], papers: [] },
} as unknown as SpaceSnapshot;
const thread = (path: string, title: string): SpaceThreadEntry =>
  ({ path, title, status: "open", messages: 1, updated: "2026-11-04T10:00:00.000Z" }) as unknown as SpaceThreadEntry;
const THREADS = [thread("discussions/a.qmd", "Loss"), thread("discussions/b.qmd", "Data")];
const presencePosts = (sent: SpacesToHost[]) => sent.filter((m) => m.type === "setConversationPresence");

function setup() {
  const sent: SpacesToHost[] = [];
  const listeners = new Set<(m: HostToSpaces) => void>();
  const end: SpacesTransport = { post: (m) => sent.push(m), subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  const receive = (m: unknown) => listeners.forEach((fn) => fn(m as HostToSpaces));
  const root = document.body.appendChild(document.createElement("div"));
  const body = mountSpaceDiscussions(root, { data, end, readOnly: false, threads: THREADS });
  return { sent, receive, root, body };
}

afterEach(() => { document.body.replaceChildren(); jest.useRealTimers(); });

describe("conversation presence sender", () => {
  it("B6 posts typing true once within 2 s of keystrokes, false 4 s after the last, and false after a send", () => {
    jest.useFakeTimers();
    const sent: SpacesToHost[] = [];
    const sender = createConversationPresenceSender({ post: (m) => sent.push(m) }, "s", () => true);
    sender.open("discussions/a.qmd");
    expect(sent).toEqual([{ type: "setConversationPresence", spaceId: "s", path: "discussions/a.qmd", typing: false }]);
    sender.draftChanged(true);
    jest.advanceTimersByTime(500); sender.draftChanged(true);
    jest.advanceTimersByTime(500); sender.draftChanged(true);
    expect(sent.map((m) => (m as { typing: boolean }).typing)).toEqual([false, true]);
    jest.advanceTimersByTime(3999);
    expect(sent).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(sent.map((m) => (m as { typing: boolean }).typing)).toEqual([false, true, false]);
    sender.draftChanged(true);
    sender.sent();
    expect(sent.map((m) => (m as { typing: boolean }).typing)).toEqual([false, true, false, true, false]);
    jest.advanceTimersByTime(5000);
    expect(sent).toHaveLength(5);
  });

  it("B6 stops typing once when the composer empties and never types without write access", () => {
    const sent: SpacesToHost[] = [];
    let writable = true;
    const sender = createConversationPresenceSender({ post: (m) => sent.push(m) }, "s", () => writable);
    sender.open("discussions/a.qmd");
    sender.draftChanged(true);
    sender.draftChanged(false);
    sender.draftChanged(false);
    expect(sent.map((m) => (m as { typing: boolean }).typing)).toEqual([false, true, false]);
    writable = false;
    sender.draftChanged(true);
    expect(sent).toHaveLength(3);
    sender.dispose();
  });
});

describe("mountSpaceDiscussions presence", () => {
  it("B6 posts the conversation on open, the new path on a switch, and null on close", () => {
    const t = setup();
    const openRow = (title: string) => {
      const row = [...t.root.querySelectorAll<HTMLElement>(".ds-rows > li")].find((li) => li.textContent?.includes(title))!;
      (row.querySelector<HTMLElement>("button") ?? row).click();
    };
    openRow("Loss");
    expect(presencePosts(t.sent).at(-1)).toEqual({ type: "setConversationPresence", spaceId: "s", path: "discussions/a.qmd", typing: false });
    t.body.dispose();
    expect(presencePosts(t.sent).at(-1)).toEqual({ type: "setConversationPresence", spaceId: "s", path: null, typing: false });
  });

  it("B7 shows who types in the open conversation, the online members and a dot on the row of another conversation", () => {
    const t = setup();
    const row = [...t.root.querySelectorAll<HTMLElement>(".ds-rows > li")].find((li) => li.textContent?.includes("Loss"))!;
    (row.querySelector<HTMLElement>("button") ?? row).click();
    const open = (presencePosts(t.sent).at(-1) as { path: string }).path;
    const other = open === "discussions/a.qmd" ? "discussions/b.qmd" : "discussions/a.qmd";
    t.receive({ type: "spacePresence", spaceId: "s", peers: [
      { name: "Ana", colour: "#f00", path: open, typing: true },
      { name: "Bruno", colour: "#0f0", path: open, typing: true },
    ] });
    expect(t.root.querySelector(".ds-typing")?.textContent).toBe("Ana and Bruno are typing…");
    expect(t.root.querySelector<HTMLElement>(".ds-online")?.hidden).toBe(false);

    t.receive({ type: "spacePresence", spaceId: "s", peers: [{ name: "Carla", colour: "#00f", path: other, typing: true }] });
    expect(t.root.querySelector(".ds-typing")?.textContent).toBe("");
    expect(t.root.querySelector(".ds-online")?.textContent).toContain("Carla");
    t.root.querySelector<HTMLElement>(".ds-detail-back, [aria-label='Back']")?.click();

    t.receive({ type: "spacePresence", spaceId: "s", peers: [] });
    expect(t.root.querySelector<HTMLElement>(".ds-online")?.hidden).toBe(true);
    expect(t.root.querySelector(".ds-typing")?.textContent ?? "").toBe("");
  });

  it("B7 marks the row of a conversation another member has open", () => {
    const t = setup();
    t.receive({ type: "spacePresence", spaceId: "s", peers: [{ name: "Carla", colour: "#00f", path: "discussions/b.qmd", typing: false }] });
    const rows = [...t.root.querySelectorAll<HTMLElement>(".ds-rows > li")];
    expect(rows.find((li) => li.textContent?.includes("Data"))?.querySelector(".ds-row-presence")).not.toBeNull();
    expect(rows.find((li) => li.textContent?.includes("Loss"))?.querySelector(".ds-row-presence")).toBeNull();
    expect(t.root.querySelector(".ds-online")?.textContent).toContain("Carla");
    t.receive({ type: "spacePresence", spaceId: "other", peers: [] });
    expect(t.root.querySelector<HTMLElement>(".ds-online")?.hidden).toBe(false);
  });
});
