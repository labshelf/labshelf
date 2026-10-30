/** @jest-environment jsdom */
// Tests that the paper detail pane's notes post paper.runCell with the language of the cell that was run, and a
// paper.restartCell message with the paper id and that language from the cell's Restart action.
//
// Assumptions about what the spec leaves open: the Restart control is a <button> whose text, aria-label or title matches /restart/i;
// the Run control matches /run/i; the message is { type: "paper.restartCell", id, language }.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { ALL_CAPABILITIES, mountForTest, paper } from "../mountHarness";

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

async function open(language: Language) {
  const t = mountForTest({ detailTab: "notes" }, ALL_CAPABILITIES);
  t.snapshot([paper("a", "papers")], ["papers/a"]);
  t.host.post({ type: "select", id: "a" });
  const notes = [{ id: "n1", anchor: "", body: body(language), created: "2026-10-01T00:00:00.000Z", author: "Ana" }];
  t.host.post({ type: "details", id: "a", details: { annotations: [], reading: null, pdf: null, notes, canRunCells: true }, canRunCells: true } as never);
  await settle();
  return t;
}
const ofType = (t: Awaited<ReturnType<typeof open>>, type: string) => t.sent.filter((m) => m.type === (type as string)) as unknown as Array<Record<string, string>>;

describe("paper notes cell messages", () => {
  it.each(LANGUAGES)("4.2a posts paper.runCell with the language of the %s cell", async (language) => {
    const t = await open(language);
    button(t.detail(), /run/i)!.click();
    await settle();
    expect(ofType(t, "paper.runCell")).toHaveLength(1);
    expect(ofType(t, "paper.runCell")[0]).toMatchObject({ type: "paper.runCell", id: "a", itemId: "n1", label: "calc", language });
    expect(ofType(t, "paper.runCell")[0]!["code"]).toContain(CODE[language]);
  });

  it.each(LANGUAGES)("4.2a posts paper.restartCell for the %s cell", async (language) => {
    const t = await open(language);
    const restart = button(t.detail(), /restart/i);
    expect(restart).toBeDefined();
    restart!.click();
    await settle();
    expect(ofType(t, "paper.restartCell")).toEqual([{ type: "paper.restartCell", id: "a", language }]);
    expect(ofType(t, "paper.runCell")).toEqual([]);
  });
});
