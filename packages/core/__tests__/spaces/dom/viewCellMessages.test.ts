/** @jest-environment jsdom */
// Tests that the Space notes and discussions views post space.runCell with the language of the cell that was run, and a
// space.restartCell message with the open file's path and that language from the cell's Restart action.
//
// Assumptions about what the spec leaves open: the Restart control is a <button> whose text, aria-label or title matches /restart/i;
// the Run control matches /run/i; the message is { type: "space.restartCell", path, language }; canRunCells sits on the space state.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { mountSpaceNotes } from "../../../src/spaces/dom/mountSpaceNotes";
import { mountSpaceDiscussions } from "../../../src/spaces/dom/mountSpaceDiscussions";
import type { SpaceSnapshot } from "../../../src/spaces/dom/mountOverview";
import type { HostToSpaces, SpacesToHost, SpacesTransport } from "../../../src/spaces/spacesProtocol";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

const LANGUAGES = ["python", "mathematica", "r"] as const;
type Language = (typeof LANGUAGES)[number];
const CODE: Record<Language, string> = { python: "print(1)", mathematica: "1 + 1", r: "x <- 1" };
const body = (language: Language) => `Intro\n\n\`\`\`{${language}}\n#| label: calc\n${CODE[language]}\n\`\`\`\n`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const text = (b: Element) => `${b.textContent ?? ""} ${b.getAttribute("aria-label") ?? ""} ${b.getAttribute("title") ?? ""}`;
const button = (root: ParentNode, re: RegExp) => [...root.querySelectorAll("button")].find((b) => re.test(text(b)));

const KINDS = [
  { name: "notes", mount: mountSpaceNotes, path: "notes/ideas.qmd", title: "Ideas", list: { type: "spaceNotes", spaceId: "s", notes: [{ path: "notes/ideas.qmd", title: "Ideas", updated: "2026-10-01" }] } },
  { name: "discussions", mount: mountSpaceDiscussions, path: "discussions/loss.qmd", title: "Which loss?",
    list: { type: "spaceDiscussions", spaceId: "s", threads: [{ path: "discussions/loss.qmd", title: "Which loss?", status: "open", messages: 1, updated: "2026-10-01" }] } },
] as const;

async function open(kind: (typeof KINDS)[number], language: Language) {
  const data = { type: "space", canRunCells: true, space: { id: "s", name: "S", folders: [], papers: [], projects: [], dates: [], extra: {}, invalid: { folders: [], papers: [], projects: [], dates: [] } },
    overview: { focus: [], projects: [], timeline: [] }, glossary: { terms: [] }, projects: [], papers: { folders: [], papers: [] } } as unknown as SpaceSnapshot;
  const sent: SpacesToHost[] = [];
  const listeners = new Set<(m: HostToSpaces) => void>();
  const end: SpacesTransport = { post: (m) => sent.push(m), subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  const receive = (m: unknown) => listeners.forEach((fn) => fn(m as HostToSpaces));
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const view = kind.mount(root, { data, end, readOnly: false });
  const items = [{ id: "i1", body: body(language), author: "Ana", created: "2026-10-01T00:00:00.000Z" }];
  receive(kind.list);
  receive({ type: "spaceQmd", spaceId: "s", path: kind.path, items });
  await settle();
  const opener = button(root, new RegExp(kind.title, "i"));
  if (opener && !button(root, /run/i)) { opener.click(); receive({ type: "spaceQmd", spaceId: "s", path: kind.path, items }); await settle(); }
  const ofType = (type: string) => sent.filter((m) => (m as { type: string }).type === type) as unknown as Array<Record<string, string>>;
  return { root, view, ofType };
}

describe.each(KINDS)("Space $name cell messages", (kind) => {
  it.each(LANGUAGES)(`4.2a ${kind.name} posts space.runCell with the language of the %s cell`, async (language) => {
    const t = await open(kind, language);
    button(t.root, /run/i)!.click();
    await settle();
    expect(t.ofType("space.runCell")).toHaveLength(1);
    expect(t.ofType("space.runCell")[0]).toMatchObject({ type: "space.runCell", path: kind.path, itemId: "i1", label: "calc", language });
    expect(t.ofType("space.runCell")[0]!["code"]).toContain(CODE[language]);
    t.view.dispose();
  });

  it.each(LANGUAGES)(`4.2a ${kind.name} posts space.restartCell for the %s cell`, async (language) => {
    const t = await open(kind, language);
    const restart = button(t.root, /restart/i);
    expect(restart).toBeDefined();
    restart!.click();
    await settle();
    expect(t.ofType("space.restartCell")).toEqual([{ type: "space.restartCell", path: kind.path, language }]);
    expect(t.ofType("space.runCell")).toEqual([]);
    t.view.dispose();
  });
});
