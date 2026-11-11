/** @jest-environment jsdom */
// Tests the Space notes and discussions views with the real editor: Run exists only when the host says canRunCells, pressing Run
// sends space.runCell, a matching space.cellState is shown while an unknown request is ignored, and a param release sends the edited
// body (editSpaceItem) before the normal space.runCell.
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
    overview: { desk: [], projects: [], timeline: [] }, glossary: { terms: [] }, projects: [], papers: { folders: [], papers: [] } } as unknown as SpaceSnapshot;
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
  it(`12.5b shows no enabled Run button in ${kind.name} when the host does not say canRunCells`, async () => {
    const t = await open(kind, false);
    expect(t.root.querySelector("button:not([disabled])[aria-label='Run all']")).toBeNull();
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
    expect(t.runs()[0]).toMatchObject({ type: "space.runCell", path: kind.path, itemId: "i1", label: "calc", language: "python" });
    expect(t.runs()[0]).not.toHaveProperty("noteKey");
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CELL = "```{python}\n#| label: calc\n#| param: n = slider(0, 10, 3)\nprint(n)\n```\n";
const PATH = "notes/ideas.qmd";
const item = { id: "i1", body: `Intro\n\n${CELL}`, author: "Ana", created: "2026-10-01T00:00:00.000Z" };

describe("param release in a Space note", () => {
  it("A5 posts the edited body before the normal space.runCell in Space notes", async () => {
    const data = { type: "space", canRunCells: true, space: { id: "s", name: "S", folders: [], papers: [], projects: [], dates: [], extra: {}, invalid: { folders: [], papers: [], projects: [], dates: [] } },
      overview: { desk: [], projects: [], timeline: [] }, glossary: { terms: [] }, projects: [], papers: { folders: [], papers: [] } } as unknown as SpaceSnapshot;
    const sent: SpacesToHost[] = [];
    const listeners = new Set<(m: HostToSpaces) => void>();
    const receive = (m: unknown) => listeners.forEach((fn) => fn(m as HostToSpaces));
    const end: SpacesTransport = {
      post: (m) => {
        sent.push(m);
        const msg = m as unknown as Record<string, unknown>;
        if (msg["type"] === "space.runCell" && msg["preview"]) {
          setTimeout(() => receive({ type: "space.cellPreview", requestId: msg["requestId"], result: { status: "ok", language: "python", text: "7", durationMs: 5 } }), 20);
        }
      },
      subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    };
    document.body.replaceChildren();
    const root = document.createElement("div");
    document.body.append(root);
    const body = mountSpaceNotes(root, { data, end, readOnly: false });
    receive({ type: "spaceNotes", spaceId: "s", notes: [{ path: PATH, title: "Ideas", updated: "2026-10-01" }] });
    receive({ type: "spaceQmd", spaceId: "s", path: PATH, items: [item] });
    await wait(60);
    if (!root.querySelector('input[type="range"]')) {
      [...root.querySelectorAll("button")].find((b) => /ideas/i.test(b.textContent ?? ""))?.click();
      receive({ type: "spaceQmd", spaceId: "s", path: PATH, items: [item] });
      await wait(100);
    }
    const range = root.querySelector<HTMLInputElement>('input[type="range"]')!;
    range.value = "7";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    range.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(600);
    const all = sent as unknown as Array<Record<string, unknown>>;
    const edit = all.findIndex((m) => m["type"] === "editSpaceItem" && String(m["body"]).includes("slider(0, 10, 7)"));
    const run = all.findIndex((m) => m["type"] === "space.runCell" && !m["preview"]);
    expect(run).toBeGreaterThanOrEqual(0);
    expect(all[run]).toMatchObject({ path: PATH, itemId: "i1", label: "calc", params: { n: 7 } });
    expect(edit).toBeGreaterThanOrEqual(0);
    expect(edit).toBeLessThan(run);
    expect(all[edit]).toMatchObject({ spaceId: "s", path: PATH, id: "i1" });
    body.dispose();
  });
});

// From paper…: a Space note's editor gets paperObjects (no default paper) only when the host announced the port and the Space is writable.
const poMounted: Array<{ paperObjects?: { port: unknown; defaultPaperId?: string; otherBodies?: () => readonly string[] }; files?: unknown }> = [];
jest.mock("../../../src/qmd/dom/qmdEditor", () => {
  const actual = jest.requireActual("../../../src/qmd/dom/qmdEditor");
  return { ...actual, mountQmdEditor: (root: HTMLElement, options: (typeof poMounted)[number]) => { poMounted.push(options); return actual.mountQmdEditor(root, options); } };
});

describe("mountSpaceNotes From paper…", () => {
  async function openNote(hasPaperObjects: boolean, readOnly: boolean) {
    poMounted.length = 0;
    const data = { type: "space", hasPaperObjects, space: { id: "s", name: "S", folders: [], papers: [], projects: [], dates: [], extra: {}, invalid: { folders: [], papers: [], projects: [], dates: [] } },
      overview: { desk: [], projects: [], timeline: [] }, glossary: { terms: [] }, projects: [], papers: { folders: [], papers: [] } } as unknown as SpaceSnapshot;
    const sent: SpacesToHost[] = [];
    const listeners = new Set<(m: HostToSpaces) => void>();
    const end: SpacesTransport = { post: (m) => sent.push(m), subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
    const receive = (m: unknown) => listeners.forEach((fn) => fn(m as HostToSpaces));
    document.body.replaceChildren();
    const root = document.createElement("div");
    document.body.append(root);
    mountSpaceNotes(root, { data, end, readOnly });
    const items = [{ id: "i1", body: "One", author: "Ana", created: "2026-10-01T00:00:00.000Z" }, { id: "i2", body: "$$x$$ {#eq-2}", author: "Ana", created: "2026-10-01T00:00:00.000Z" }];
    receive(KINDS[0].list);
    receive({ type: "spaceQmd", spaceId: "s", path: "notes/ideas.qmd", items });
    await settle();
    if (poMounted.length === 0) { button(root, /Ideas/i)?.click(); receive({ type: "spaceQmd", spaceId: "s", path: "notes/ideas.qmd", items }); await settle(); }
    return { sent, receive };
  }

  it("passes paperObjects without a default paper when the host announced it, and posts its calls as space.paperObjects", async () => {
    const { sent, receive } = await openNote(true, false);
    const options = poMounted.find((o) => o.paperObjects !== undefined)!;
    expect(options.files).toBeDefined();
    expect(options.paperObjects!.defaultPaperId).toBeUndefined();
    expect(options.paperObjects!.otherBodies?.()).toContain("$$x$$ {#eq-2}");
    const port = options.paperObjects!.port as { papers(query: string): Promise<unknown> };
    const papers = port.papers("att");
    const request = sent.at(-1) as unknown as { type: string; request: { requestId: string; call: unknown } };
    expect(request.type).toBe("space.paperObjects");
    expect(request.request.call).toEqual({ op: "papers", query: "att" });
    receive({ type: "paperObjects.reply", requestId: request.request.requestId, value: [] });
    await expect(papers).resolves.toEqual([]);
  });

  it("passes no paperObjects when the host did not announce it or the Space is read-only", async () => {
    await openNote(false, false);
    expect(poMounted.length).toBeGreaterThan(0);
    expect(poMounted.every((o) => o.paperObjects === undefined)).toBe(true);
    await openNote(true, true);
    expect(poMounted.length).toBeGreaterThan(0);
    expect(poMounted.every((o) => o.paperObjects === undefined)).toBe(true);
  });
});
