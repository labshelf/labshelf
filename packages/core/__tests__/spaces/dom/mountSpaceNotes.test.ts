/** @jest-environment jsdom */
// Tests the Space notes and discussions views with the real editor: Run exists only when the host says canRunCells, pressing Run
// sends space.runCell, and a matching space.cellState is shown while an unknown request is ignored.
//
// Assumptions about what the spec leaves open: canRunCells sits on the `space` state (SpaceSnapshot); the view lists the items it
// receives in `spaceQmd` for the path it has open; the Run and Cancel controls are <button>s whose text, aria-label or title match
// /run/i and /cancel/i; the notes view lists notes with a button showing the note title, the discussions view shows the thread
// messages once the thread is opened by its title.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { mountSpaceNotes } from "../../../src/spaces/dom/mountSpaceNotes";
import { mountSpaceDiscussions } from "../../../src/spaces/dom/mountSpaceDiscussions";
import type { SpaceSnapshot } from "../../../src/spaces/dom/mountOverview";
import type { HostToSpaces, SpacesToHost, SpacesTransport } from "../../../src/spaces/spacesProtocol";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

const BODY = "Intro\n\n```{python}\n#| label: calc\nprint(1)\n```\n";
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const text = (b: Element) => `${b.textContent ?? ""} ${b.getAttribute("aria-label") ?? ""} ${b.getAttribute("title") ?? ""}`;
const button = (root: ParentNode, re: RegExp) => [...root.querySelectorAll("button")].find((b) => re.test(text(b)));

const KINDS = [
  { name: "notes", mount: mountSpaceNotes, path: "notes/ideas.qmd", title: "Ideas", list: { type: "spaceNotes", spaceId: "s", notes: [{ path: "notes/ideas.qmd", title: "Ideas", updated: "2026-10-01" }] } },
  { name: "discussions", mount: mountSpaceDiscussions, path: "discussions/loss.qmd", title: "Which loss?",
    list: { type: "spaceDiscussions", spaceId: "s", threads: [{ path: "discussions/loss.qmd", title: "Which loss?", status: "open", messages: 1, updated: "2026-10-01" }] } },
] as const;

async function open(kind: (typeof KINDS)[number], canRunCells: boolean) {
  const data = { type: "space", canRunCells, space: { id: "s", name: "S", folders: [], papers: [], projects: [], dates: [], extra: {}, invalid: { folders: [], papers: [], projects: [], dates: [] } },
    overview: { focus: [], projects: [], timeline: [] }, glossary: { terms: [] }, projects: [], papers: { folders: [], papers: [] } } as unknown as SpaceSnapshot;
  const sent: SpacesToHost[] = [];
  const listeners = new Set<(m: HostToSpaces) => void>();
  const end: SpacesTransport = { post: (m) => sent.push(m), subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  const receive = (m: unknown) => listeners.forEach((fn) => fn(m as HostToSpaces));
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const body = kind.mount(root, { data, end, readOnly: false });
  receive(kind.list);
  receive({ type: "spaceQmd", spaceId: "s", path: kind.path, items: [{ id: "i1", body: BODY, author: "Ana", created: "2026-10-01T00:00:00.000Z" }] });
  await settle();
  const opener = button(root, new RegExp(kind.title, "i"));
  if (opener && !button(root, /run/i)) { opener.click(); receive({ type: "spaceQmd", spaceId: "s", path: kind.path, items: [{ id: "i1", body: BODY, author: "Ana", created: "2026-10-01T00:00:00.000Z" }] }); await settle(); }
  const runs = () => sent.filter((m) => (m as { type: string }).type === "space.runCell") as unknown as Array<Record<string, string> & { requestId: string }>;
  return { root, sent, receive, runs, body };
}

describe.each(KINDS)("Space $name run cells", (kind) => {
  it(`12.5b shows no Run button in ${kind.name} when the host does not say canRunCells`, async () => {
    const t = await open(kind, false);
    expect(button(t.root, /run/i)).toBeUndefined();
    t.body.dispose();
  });

  it(`12.5b shows a Run button in ${kind.name} when the host says canRunCells and runs nothing on open`, async () => {
    const t = await open(kind, true);
    expect(button(t.root, /run/i)).toBeDefined();
    expect(t.runs()).toEqual([]);
    t.body.dispose();
  });

  it(`12.5b sends space.runCell with the path, item id, label, code and a request id on Run in ${kind.name}`, async () => {
    const t = await open(kind, true);
    button(t.root, /run/i)!.click();
    await settle();
    expect(t.runs()).toHaveLength(1);
    expect(t.runs()[0]).toMatchObject({ type: "space.runCell", path: kind.path, itemId: "i1", label: "calc" });
    expect(t.runs()[0]!["code"]).toContain("print(1)");
    expect(t.runs()[0]!["requestId"].length).toBeGreaterThan(0);
    t.body.dispose();
  });

  it(`12.5b shows Cancel for a matching running state in ${kind.name} and sends space.cancelCell`, async () => {
    const t = await open(kind, true);
    button(t.root, /run/i)!.click();
    await settle();
    const requestId = t.runs()[0]!["requestId"];
    t.receive({ type: "space.cellState", requestId, state: "running" });
    await settle();
    const cancel = button(t.root, /cancel/i);
    expect(cancel).toBeDefined();
    cancel!.click();
    expect(t.sent).toContainEqual({ type: "space.cancelCell", requestId });
    t.body.dispose();
  });

  it.each(["done", "error", "cancelled", "missing"])(`12.5b drops the Cancel button in ${kind.name} on a matching %s state`, async (state) => {
    const t = await open(kind, true);
    button(t.root, /run/i)!.click();
    await settle();
    const requestId = t.runs()[0]!["requestId"];
    t.receive({ type: "space.cellState", requestId, state: "running" });
    await settle();
    expect(button(t.root, /cancel/i)).toBeDefined();
    t.receive({ type: "space.cellState", requestId, state });
    await settle();
    expect(button(t.root, /cancel/i)).toBeUndefined();
    t.body.dispose();
  });

  it(`12.5b mentions Python in ${kind.name} on a missing-python state`, async () => {
    const t = await open(kind, true);
    button(t.root, /run/i)!.click();
    await settle();
    t.receive({ type: "space.cellState", requestId: t.runs()[0]!["requestId"], state: "missing" });
    await settle();
    expect(t.root.textContent).toMatch(/python/i);
    t.body.dispose();
  });

  it(`12.5b ignores a space.cellState for an unknown request in ${kind.name}`, async () => {
    const t = await open(kind, true);
    button(t.root, /run/i)!.click();
    await settle();
    t.receive({ type: "space.cellState", requestId: "someone-else", state: "running" });
    await settle();
    expect(button(t.root, /cancel/i)).toBeUndefined();
    t.body.dispose();
  });
});
