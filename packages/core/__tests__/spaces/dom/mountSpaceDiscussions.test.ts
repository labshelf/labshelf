/** @jest-environment jsdom */
// Tests the Discussions tab with the real editors: the Space chat opens without a file, Enter sends the draft (Shift+Enter does not),
// Reply quoting puts the quote in the draft, and a message's actions record an agreement and create a task tied to it.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { mountSpaceDiscussions } from "../../../src/spaces/dom/mountSpaceDiscussions";
import type { SpaceSnapshot } from "../../../src/spaces/dom/mountOverview";
import { SPACE_CHAT_PATH } from "../../../src/spaces/spaceDiscussionsStore";
import type { HostToSpaces, SpacesToHost, SpacesTransport } from "../../../src/spaces/spacesProtocol";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}
// jsdom has no layout; CodeMirror measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });

const MESSAGE = { id: "m1", body: "Let us use the Huber loss.", author: "Bo", created: "2026-11-04T10:00:00.000Z" };
const data = {
  type: "space", author: "Ana",
  space: { id: "s", name: "S", folders: [], papers: [], projects: [], dates: [], extra: {}, invalid: { folders: [], papers: [], projects: [], dates: [] } },
  overview: { desk: [], projects: [], timeline: [] }, glossary: { terms: [] }, projects: [], papers: { folders: [], papers: [] },
} as unknown as SpaceSnapshot;

function setup() {
  const sent: SpacesToHost[] = [];
  const listeners = new Set<(m: HostToSpaces) => void>();
  const end: SpacesTransport = { post: (m) => sent.push(m), subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  const receive = (m: unknown) => listeners.forEach((fn) => fn(m as HostToSpaces));
  const root = document.body.appendChild(document.createElement("div"));
  const body = mountSpaceDiscussions(root, { data, end, readOnly: false, threads: [] });
  const button = (label: string) => [...root.querySelectorAll("button")].find((b) => b.textContent === label || b.getAttribute("aria-label") === label)!;
  return { sent, receive, root, body, button };
}

const submit = (label: string): void => {
  const form = document.querySelector<HTMLFormElement>(`form[aria-label="${label}"]`)!;
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
};

afterEach(() => { document.body.replaceChildren(); });

describe("mountSpaceDiscussions", () => {
  it("opens the Space chat before its file exists and sends a quoted reply with Enter, not Shift+Enter", () => {
    const t = setup();
    t.button("Open").click();
    expect(t.sent.at(-1)).toEqual({ type: "readSpaceQmd", spaceId: "s", path: SPACE_CHAT_PATH });
    t.receive({ type: "spaceDiscussions", spaceId: "s", threads: [] });
    expect(t.root.querySelector(".ds-thread-title h2")?.textContent).toBe("Space chat");
    t.receive({ type: "spaceQmd", spaceId: "s", path: SPACE_CHAT_PATH, items: [MESSAGE, { ...MESSAGE, id: "m2", author: "Ana" }] });
    expect(t.root.querySelector('[data-item-id="m2"]')?.classList.contains("own")).toBe(true);
    expect(t.root.querySelector('[data-item-id="m2"] .ds-msg-head strong')?.textContent).toBe("You");

    t.root.querySelector<HTMLButtonElement>('[data-item-id="m1"] [aria-label="Reply quoting"]')!.click();
    const editor = t.root.querySelector(".ds-reply-editor .ProseMirror")!;
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
    expect(t.sent.some((m) => m.type === "addSpaceItem")).toBe(false);
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const sentItem = t.sent.find((m) => m.type === "addSpaceItem") as Extract<SpacesToHost, { type: "addSpaceItem" }>;
    expect(sentItem).toMatchObject({ spaceId: "s", path: SPACE_CHAT_PATH });
    expect(sentItem.body).toMatch(/^> \*\*Bo\*\* · Let us use the Huber loss\./);
    t.body.dispose();
  });

  it("records an agreement and creates a task from a message", () => {
    const t = setup();
    const path = "discussions/loss.qmd";
    t.receive({ type: "spaceDiscussions", spaceId: "s", threads: [{ path, title: "Loss", status: "open", messages: 1, updated: MESSAGE.created }] });
    t.root.querySelector<HTMLButtonElement>(`.ds-row[data-path="${path}"]`)!.click();
    t.receive({ type: "spaceQmd", spaceId: "s", path, items: [{ id: "topic", body: "# Loss\n" }, MESSAGE] });

    t.root.querySelector<HTMLButtonElement>('[data-item-id="m1"] [aria-label="Record agreement"]')!.click();
    expect(document.querySelector<HTMLTextAreaElement>('form[aria-label="Record agreement"] textarea')!.value).toBe("Let us use the Huber loss.");
    submit("Record agreement");
    expect(t.sent.at(-1)).toEqual({ type: "addAgreement", id: "s", agreement: { path, itemId: "m1", text: "Let us use the Huber loss." } });

    t.root.querySelector<HTMLButtonElement>('[data-item-id="m1"] [aria-label="Create task"]')!.click();
    const form = document.querySelector<HTMLFormElement>('form[aria-label="Create task"]')!;
    form.querySelector<HTMLInputElement>('input[name="assignee"]')!.value = "Bo";
    form.querySelector<HTMLInputElement>('input[name="date"]')!.value = "2026-11-10";
    submit("Create task");
    expect(t.sent.at(-1)).toEqual({ type: "addDate", id: "s", date: {
      kind: "task", title: "Let us use the Huber loss.", date: "2026-11-10", done: false, assignee: "Bo", source: { path, itemId: "m1" },
    } });
    t.body.dispose();
  });
});

describe("mountSpaceDiscussions unread and composer tools", () => {
  const TOPIC = { path: "discussions/loss.qmd", title: "Loss", status: "open", messages: 2, updated: "2026-11-04T10:00:00.000Z", unread: 2 };

  it("shows the unread count on the row and marks the conversation seen when it opens", () => {
    const t = setup();
    t.receive({ type: "spaceDiscussions", spaceId: "s", threads: [TOPIC] });
    const row = t.root.querySelector<HTMLButtonElement>(`.ds-row[data-path="${TOPIC.path}"]`)!;
    expect(row.classList.contains("unread")).toBe(true);
    expect(row.querySelector(".ds-badge")?.textContent).toBe("2");
    expect(t.root.querySelector(".ds-card-foot")?.textContent).toBe("2 new messages");
    row.click();
    expect(t.sent.some((m) => m.type === "markSeen")).toBe(false);
    t.receive({ type: "spaceQmd", spaceId: "s", path: TOPIC.path, items: [{ id: "topic", body: "# Loss\n" }, MESSAGE] });
    expect(t.sent).toContainEqual({ type: "markSeen", id: "s", path: TOPIC.path });
    t.body.dispose();
  });

  it("does not mark seen on a read-only Space", () => {
    const sent: SpacesToHost[] = [];
    const end: SpacesTransport = { post: (m) => sent.push(m), subscribe: () => () => {} };
    const root = document.body.appendChild(document.createElement("div"));
    const body = mountSpaceDiscussions(root, { data, end, readOnly: true, threads: [TOPIC as never], path: TOPIC.path });
    expect(sent.some((m) => m.type === "markSeen")).toBe(false);
    body.dispose();
  });

  it("Σ puts inline math in the draft and an emoji from the grid goes into the sent message", () => {
    const t = setup();
    t.button("Open").click();
    t.button("Insert emoji").click();
    const grid = document.querySelector('[aria-label="Emoji"]')!;
    expect(grid.querySelectorAll("button").length).toBeGreaterThanOrEqual(40);
    grid.querySelector<HTMLButtonElement>('[aria-label="👍"]')!.click();
    expect(document.querySelector('[aria-label="Emoji"]')).toBeNull();
    t.root.querySelector(".ds-reply-editor .ProseMirror")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const sentItem = t.sent.find((m) => m.type === "addSpaceItem") as Extract<SpacesToHost, { type: "addSpaceItem" }>;
    expect(sentItem.body).toContain("👍");
    t.button("Insert inline math").click();
    expect(t.root.querySelector(".ds-reply-editor .qmd-math-inline")).not.toBeNull();
    t.body.dispose();
  });
});

describe("mountSpaceDiscussions live conversation", () => {
  const path = "discussions/loss.qmd";
  const TOPIC_ITEM = { id: "topic", body: "# Loss\n\nWhich loss?", author: "Bo" };
  const OWN = { id: "m2", body: "I agree.", author: "Ana", created: "2026-11-04T10:05:00.000Z" };
  const entry = (patch: Record<string, unknown> = {}) => ({ path, title: "Loss", status: "open", messages: 2, updated: "2026-11-04T10:05:00.000Z",
    last: { body: OWN.body, author: "Ana", created: OWN.created }, ...patch });
  const reads = (sent: SpacesToHost[]) => sent.filter((m) => m.type === "readSpaceQmd").length;
  const messageNode = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-item-id="${id}"]`);

  function open() {
    const t = setup();
    t.receive({ type: "spaceDiscussions", spaceId: "s", threads: [entry()] });
    t.root.querySelector<HTMLButtonElement>(`.ds-row[data-path="${path}"]`)!.click();
    t.receive({ type: "spaceQmd", spaceId: "s", path, items: [TOPIC_ITEM, MESSAGE, OWN] });
    return t;
  }

  it("A1 reads the open conversation once when its entry changes, and not when it is unchanged", () => {
    const t = open();
    const before = reads(t.sent);
    t.receive({ type: "spaceDiscussions", spaceId: "s", threads: [entry()] });
    expect(reads(t.sent)).toBe(before);
    const grown = entry({ messages: 3, updated: "2026-11-04T10:09:00.000Z", last: { body: "New", author: "Bo", created: "2026-11-04T10:09:00.000Z" } });
    t.receive({ type: "spaceDiscussions", spaceId: "s", threads: [grown] });
    t.receive({ type: "spaceDiscussions", spaceId: "s", threads: [grown] });
    expect(reads(t.sent)).toBe(before + 1);
    expect(t.sent.at(-1)).toEqual({ type: "readSpaceQmd", spaceId: "s", path });
    t.body.dispose();
  });

  it("A2 keeps every earlier message element and appends the new one", () => {
    const t = open();
    const nodes = ["topic", "m1", "m2"].map((id) => messageNode(t.root, id));
    t.receive({ type: "spaceQmd", spaceId: "s", path, items: [TOPIC_ITEM, MESSAGE, OWN, { id: "m3", body: "New", author: "Bo", created: "2026-11-04T10:09:00.000Z" }] });
    ["topic", "m1", "m2"].forEach((id, at) => expect(messageNode(t.root, id)).toBe(nodes[at]));
    expect(t.root.querySelectorAll(".ds-message")).toHaveLength(4);
    expect(messageNode(t.root, "m3")).not.toBeNull();
    t.body.dispose();
  });

  it("A3 a space snapshot with a changed saved array replaces no message element", () => {
    const t = open();
    const nodes = ["topic", "m1", "m2"].map((id) => messageNode(t.root, id));
    t.body.update({ ...data, space: { ...data.space, saved: [{ path, itemId: "m1", by: "Ana", created: "2026-11-04T11:00:00.000Z" }] } } as never);
    ["topic", "m1", "m2"].forEach((id, at) => expect(messageNode(t.root, id)).toBe(nodes[at]));
    expect(messageNode(t.root, "m1")!.querySelector('[aria-label="Remove from saved"]')).not.toBeNull();
    t.body.dispose();
  });

  it("A4 marks seen only once the items are shown, not from a list snapshot alone", () => {
    const t = setup();
    t.receive({ type: "spaceDiscussions", spaceId: "s", threads: [entry({ unread: 1 })] });
    t.root.querySelector<HTMLButtonElement>(`.ds-row[data-path="${path}"]`)!.click();
    t.receive({ type: "spaceDiscussions", spaceId: "s", threads: [entry({ unread: 2, messages: 3 })] });
    expect(t.sent.some((m) => m.type === "markSeen")).toBe(false);
    t.receive({ type: "spaceQmd", spaceId: "s", path, items: [TOPIC_ITEM, MESSAGE, OWN] });
    expect(t.sent).toContainEqual({ type: "markSeen", id: "s", path });
    t.body.dispose();
  });

  it("A5 edits an own message with Save, cancels with Escape, and shows no Edit or Delete on others' messages", () => {
    const t = open();
    expect(messageNode(t.root, "m1")!.querySelector('[aria-label="Edit"]')).toBeNull();
    expect(messageNode(t.root, "m1")!.querySelector('[aria-label="Delete"]')).toBeNull();
    expect(messageNode(t.root, "topic")!.querySelector('[aria-label="Edit"]')).toBeNull();
    messageNode(t.root, "m2")!.querySelector<HTMLButtonElement>('[aria-label="Edit"]')!.click();
    const form = messageNode(t.root, "m2")!.querySelector<HTMLElement>(".ds-edit")!;
    form.querySelector(".ProseMirror")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(t.sent.some((m) => m.type === "editSpaceItem")).toBe(false);
    expect(messageNode(t.root, "m2")!.querySelector(".ds-edit")).toBeNull();
    messageNode(t.root, "m2")!.querySelector<HTMLButtonElement>('[aria-label="Edit"]')!.click();
    [...messageNode(t.root, "m2")!.querySelectorAll("button")].find((b) => b.textContent === "Save")!.click();
    expect(t.sent.at(-1)).toEqual({ type: "editSpaceItem", spaceId: "s", path, id: "m2", body: "I agree." });
    t.body.dispose();
  });

  it("A6 deletes an own message after the confirmation, and not when it is dismissed", async () => {
    const t = open();
    const dialogButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(".ls-dialog button")].find((b) => b.textContent === label)!;
    messageNode(t.root, "m2")!.querySelector<HTMLButtonElement>('[aria-label="Delete"]')!.click();
    dialogButton("Cancel").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.sent.some((m) => m.type === "removeSpaceItem")).toBe(false);
    messageNode(t.root, "m2")!.querySelector<HTMLButtonElement>('[aria-label="Delete"]')!.click();
    dialogButton("Delete").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.sent.at(-1)).toEqual({ type: "removeSpaceItem", spaceId: "s", path, id: "m2" });
    t.body.dispose();
  });

  it("A7 shows (edited) with the ISO time as its title", () => {
    const t = open();
    t.receive({ type: "spaceQmd", spaceId: "s", path, items: [TOPIC_ITEM, MESSAGE, { ...OWN, edited: "2026-11-04T12:00:00.000Z" }] });
    const mark = messageNode(t.root, "m2")!.querySelector(".ds-edited")!;
    expect(mark.textContent).toBe("(edited)");
    expect(mark.getAttribute("title")).toBe("2026-11-04T12:00:00.000Z");
    expect(messageNode(t.root, "m1")!.querySelector(".ds-edited")).toBeNull();
    t.body.dispose();
  });

  it("A8 renames the topic from the More menu, keeping its text", () => {
    const t = open();
    t.root.querySelector<HTMLButtonElement>('.ds-thread-head [aria-label="More actions"]')!.click();
    [...document.querySelectorAll<HTMLButtonElement>(".ls-menu-item")].find((b) => b.textContent?.includes("Rename topic…"))!.click();
    const form = document.querySelector<HTMLFormElement>('form[aria-label="Rename topic"]')!;
    form.querySelector<HTMLInputElement>('input[name="title"]')!.value = "New title";
    submit("Rename topic");
    expect(t.sent.at(-1)).toEqual({ type: "editSpaceItem", spaceId: "s", path, id: "topic", body: "# New title\n\nWhich loss?" });
    t.body.dispose();
  });

  it("A10 shows the New messages pill and keeps the scroll position when scrolled up", () => {
    const t = open();
    const list = t.root.querySelector<HTMLElement>(".ds-messages")!;
    let top = 100;
    Object.defineProperty(list, "scrollHeight", { configurable: true, get: () => 1000 });
    Object.defineProperty(list, "clientHeight", { configurable: true, get: () => 200 });
    Object.defineProperty(list, "scrollTop", { configurable: true, get: () => top, set: (value: number) => { top = value; } });
    const pill = t.root.querySelector<HTMLButtonElement>(".ds-new-pill")!;
    expect(pill.hidden).toBe(true);
    t.receive({ type: "spaceQmd", spaceId: "s", path, items: [TOPIC_ITEM, MESSAGE, OWN, { id: "m3", body: "New", author: "Bo", created: "2026-11-04T10:09:00.000Z" }] });
    expect(pill.hidden).toBe(false);
    expect(top).toBe(100);
    pill.click();
    expect(top).toBe(1000);
    expect(pill.hidden).toBe(true);
    t.body.dispose();
  });
});
