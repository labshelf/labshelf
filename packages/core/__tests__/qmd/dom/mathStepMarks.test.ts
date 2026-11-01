/** @jest-environment jsdom */
// Tests the step marks of the math node view (plan math-in-prose D9, D12) through mountQmdEditor with a fake check runner:
// a checked step shows its mark after the math (inline) or one mark per aligned line (display), a differing step is
// underlined with the wavy class, a sampled step never reads as proved, and a hover on a mark shows the shared card.
//
// Assumptions, since the spec fixes no selectors: a mark is an element whose whole text is its glyph (✓ ≈ ✗ ⚠ ?) inside the
// `.qmd-math` node view, carrying (itself or on an ancestor inside the node view) an aria-label that names the D4 state word;
// the wavy underline is a class whose name contains "wavy" on the `.qmd-math` element or inside it; the hover card is
// reached by pointer events (or focus) on the mark and puts its text anywhere in the document. The fake runner is called as
// onEvalMath(request, callback) with request.tex holding one step and callback receiving the D4 reply object.
import { mountQmdEditor, type QmdEditorHandle, type QmdEditorOptions } from "../../../src/qmd/dom/qmdEditor";

jest.setTimeout(15000);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const GLYPHS = ["✓", "≈", "✗", "⚠", "?"];

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await sleep(10);
  }
}

interface Reply { state: string; readAs: string; rewrites: string[]; messages: string[]; counterexample?: { point: Record<string, number>; lhs: string; rhs: string }; condition?: string }
type Request = { op: string; tex: string };

const reply = (state: string, extra: Partial<Reply> = {}): Reply => ({ state, readAs: "", rewrites: [], messages: [], ...extra });
const compact = (tex: string) => tex.replace(/[\s&]/g, "");

/** A fake runner answering each step by its compact tex (spaces and `&` removed); an unknown step gets state failed. */
function fakeRunner(table: Record<string, Reply>) {
  const calls: Request[] = [];
  const onEvalMath = (request: Request, callback: (result: Reply) => void): void => {
    calls.push(request);
    const answer = table[compact(request.tex)] ?? reply("failed");
    setTimeout(() => callback(answer), 0);
  };
  return { calls, onEvalMath };
}

let mounted: QmdEditorHandle[] = [];
afterEach(() => {
  for (const handle of mounted) { try { handle.destroy(); } catch { /* already destroyed */ } }
  mounted = [];
  document.body.innerHTML = "";
});

function setup(body: string, runner?: ReturnType<typeof fakeRunner>) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const changes: string[] = [];
  const options = { body, onChange: (next: string) => changes.push(next), cellsAbove: () => [], ...(runner ? { onEvalMath: runner.onEvalMath } : {}) } as unknown as QmdEditorOptions;
  mounted.push(mountQmdEditor(root, options));
  return { root, changes };
}

/** Opens the first math's TeX field, types `tex` into it as the user would, and leaves the field. */
async function editMath(root: HTMLElement, tex: string): Promise<void> {
  root.querySelector<HTMLElement>(".qmd-math-rendered")!.click();
  await until(() => root.querySelector('[aria-label="TeX source"]') !== null);
  const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="TeX source"]')!;
  input.value = tex;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

/** The glyph elements of the marks, in document order. */
function glyphs(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".qmd-math *")).filter((el) => GLYPHS.includes((el.textContent ?? "").trim()) && !el.querySelector("*"));
}
const glyphText = (root: HTMLElement) => glyphs(root).map((el) => (el.textContent ?? "").trim());
/** The element carrying the mark's aria-label. */
const markOf = (glyph: HTMLElement): HTMLElement | null => glyph.closest<HTMLElement>("[aria-label]:not([aria-label='TeX source'])");

function hover(el: HTMLElement): void {
  for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"]) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}

const DIFFERS = reply("differs", {
  readAs: "Equal[Power[x, 2], Times[2, x]]",
  rewrites: ["leibniz-rule"],
  messages: ["Sampled twelve points"],
  counterexample: { point: { x: 1.37 }, lhs: "4.4177", rhs: "9.8123" },
});

describe("math step marks", () => {
  it("4.3a a differs step shows ✗ after the inline math", async () => {
    const runner = fakeRunner({ "x^2=2x": DIFFERS });
    const { root } = setup("Check $a = b$ now.", runner);
    await editMath(root, "x^2 = 2x");
    await until(() => glyphText(root).length > 0);
    expect(glyphText(root)).toEqual(["✗"]);
  });

  it("4.3a a differs step puts the wavy class on its math", async () => {
    const runner = fakeRunner({ "x^2=2x": DIFFERS });
    const { root } = setup("Check $a = b$ now.", runner);
    await editMath(root, "x^2 = 2x");
    await until(() => glyphText(root).length > 0);
    const math = root.querySelector<HTMLElement>(".qmd-math")!;
    expect(math.matches('[class*="wavy"]') || math.querySelector('[class*="wavy"]') !== null).toBe(true);
  });

  it("4.3a a differs mark has an aria-label naming the state", async () => {
    const runner = fakeRunner({ "x^2=2x": DIFFERS });
    const { root } = setup("Check $a = b$ now.", runner);
    await editMath(root, "x^2 = 2x");
    await until(() => glyphText(root).length > 0);
    expect(markOf(glyphs(root)[0]!)?.getAttribute("aria-label") ?? "").toMatch(/differs/i);
  });

  it("4.3a hovering a ✗ mark shows the point and both values", async () => {
    const runner = fakeRunner({ "x^2=2x": DIFFERS });
    const { root } = setup("Check $a = b$ now.", runner);
    await editMath(root, "x^2 = 2x");
    await until(() => glyphText(root).length > 0);
    hover(glyphs(root)[0]!);
    const shown = document.body.textContent ?? "";
    expect(shown).toContain("1.37");
    expect(shown).toContain("4.4177");
    expect(shown).toContain("9.8123");
  });

  it("4.3a the hover card shows Read as, the rewrites and the messages", async () => {
    const runner = fakeRunner({ "x^2=2x": DIFFERS });
    const { root } = setup("Check $a = b$ now.", runner);
    await editMath(root, "x^2 = 2x");
    await until(() => glyphText(root).length > 0);
    hover(glyphs(root)[0]!);
    const shown = document.body.textContent ?? "";
    expect(shown).toContain("Equal[Power[x, 2], Times[2, x]]");
    expect(shown).toContain("leibniz-rule");
    expect(shown).toContain("Sampled twelve points");
  });

  it("4.3a a sampled step shows ≈ and never ✓", async () => {
    const runner = fakeRunner({ "x+x=2x": reply("sampled", { readAs: "SAMPLED-READ" }) });
    const { root } = setup("Check $a = b$ now.", runner);
    await editMath(root, "x + x = 2x");
    await until(() => glyphText(root).length > 0);
    expect(glyphText(root)).toEqual(["≈"]);
    expect(root.textContent).not.toContain("✓");
  });

  it("4.3a a sampled mark has an aria-label naming sampled and no wavy class", async () => {
    const runner = fakeRunner({ "x+x=2x": reply("sampled") });
    const { root } = setup("Check $a = b$ now.", runner);
    await editMath(root, "x + x = 2x");
    await until(() => glyphText(root).length > 0);
    expect(markOf(glyphs(root)[0]!)?.getAttribute("aria-label") ?? "").toMatch(/sampled/i);
    expect(root.querySelector('.qmd-math [class*="wavy"]')).toBeNull();
  });

  it("4.3a a proved step shows ✓ with an aria-label naming proved", async () => {
    const runner = fakeRunner({ "x+x=2x": reply("proved") });
    const { root } = setup("Check $a = b$ now.", runner);
    await editMath(root, "x + x = 2x");
    await until(() => glyphText(root).length > 0);
    expect(glyphText(root)).toEqual(["✓"]);
    expect(markOf(glyphs(root)[0]!)?.getAttribute("aria-label") ?? "").toMatch(/proved/i);
  });

  it("4.3a the ≈ mark is drawn with a different class from the ✓ mark", async () => {
    const runner = fakeRunner({ "x+x=2x": reply("proved"), "2x=x^2": reply("sampled") });
    const { root } = setup("Check $a = b$ now.", runner);
    await editMath(root, "x + x = 2x = x^2");
    await until(() => glyphText(root).length >= 2);
    const [proved, sampled] = glyphs(root).map(markOf);
    expect(glyphText(root)).toEqual(["✓", "≈"]);
    expect(proved!.className).not.toBe("");
    expect(sampled!.className).not.toBe(proved!.className);
  });

  it("4.3a a conditional step shows ⚠ and an unread step shows ?", async () => {
    const runner = fakeRunner({ "x+x=2x": reply("conditional", { condition: "x>0" }), "2x=x^2": reply("unread", { messages: ["Refused symbol Run"] }) });
    const { root } = setup("Check $a = b$ now.", runner);
    await editMath(root, "x + x = 2x = x^2");
    await until(() => glyphText(root).length >= 2);
    expect(glyphText(root)).toEqual(["⚠", "?"]);
    expect(glyphs(root).every((glyph) => (markOf(glyph)?.getAttribute("aria-label") ?? "") !== "")).toBe(true);
  });

  it("4.3a a display math with aligned lines shows one mark per line, in line order", async () => {
    const runner = fakeRunner({ "a=b": reply("proved"), "b=c": DIFFERS });
    const { root } = setup("$$\nx = y\n$$\n", runner);
    await editMath(root, "\\begin{aligned} a &= b \\\\ &= c \\end{aligned}");
    await until(() => glyphText(root).length >= 2);
    expect(glyphText(root)).toEqual(["✓", "✗"]);
  });

  it("4.3a shows no mark when the editor has no onEvalMath", async () => {
    const { root } = setup("Check $a = b$ now.");
    await editMath(root, "x + x = 2x");
    await sleep(1300);
    expect(glyphText(root)).toEqual([]);
  });

  it("4.3a writes no mark into the body", async () => {
    const runner = fakeRunner({ "x^2=2x": DIFFERS });
    const { root, changes } = setup("Check $a = b$ now.", runner);
    await editMath(root, "x^2 = 2x");
    await until(() => glyphText(root).length > 0);
    await sleep(450);
    const last = changes[changes.length - 1]!;
    expect(last).toContain("$x^2 = 2x$");
    for (const glyph of GLYPHS.slice(0, 4)) expect(last).not.toContain(glyph);
    expect(last).not.toContain("wavy");
  });
});
