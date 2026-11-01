/** @jest-environment jsdom */
/**
 * Tests the 2a experience through mountQmdEditor with a fake onEvalMath runner: leaving `$expr =$` asks the runner and inserts the
 * result span in one undoable step, a reply for math that changed is dropped, a result whose cells above changed shows out of date
 * with Recompute, and without a runner the stored result renders and nothing offers to compute.
 *
 * Assumptions, since the spec fixes no selectors or call shapes:
 * - QmdEditorOptions.onEvalMath(request, callback) is called with `{ op, tex }` (more keys allowed) and the host answers by calling
 *   callback(result) with a D4 MathResult `{ state, latex?, readAs, rewrites, messages }`; QmdEditorOptions.cellsAbove(pos) returns the
 *   code strings of the Mathematica cells above `pos` (an array, or a promise of one) and is read again whenever the check runs.
 * - The fake supplier returns every Mathematica cell of the current body, which is "earlier items' cells then this item's cells above"
 *   for a result that follows its cells.
 * - Leaving an inline math is the Enter key in its LaTeX input (the editor's own way to leave it).
 * - MathJax is mocked: a typeset TeX is `<svg data-tex="TEX">`, so a result shows as an svg whose data-tex is its LaTeX.
 * - An out-of-date result carries a class containing "out-of-date" or the words "out of date" in the editor; Recompute is a button
 *   (or role button/menuitem) whose text or aria-label says "Recompute", reached by hovering or focusing the result's elements.
 * - Layout, colour and glyph classes of the states (3.3 css) are not tested.
 */
import { mountQmdEditor, type QmdEditorHandle } from "../../../src/qmd/dom/qmdEditor";
import { until, settle } from "../../support/nodeViewHarness";

jest.mock("../../../src/latex/hover/index", () => ({ renderMathSvg: (tex: string) => `<svg data-tex="${tex}"></svg>` }));

// jsdom has no layout; CodeMirror measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

interface Request { op: string; tex: string }
interface Reply { state: string; latex?: string; readAs: string; rewrites: string[]; messages: string[] }
interface Call { request: Request; reply(result: Reply): void }
interface Setup { root: HTMLElement; handle: QmdEditorHandle; calls: Call[]; changes: string[]; body: string }

let mounted: QmdEditorHandle[] = [];
afterEach(() => {
  for (const handle of mounted) { try { handle.destroy(); } catch { /* already destroyed */ } }
  mounted = [];
  document.body.innerHTML = "";
});

const value = (latex: string): Reply => ({ state: "value", latex, readAs: "Integrate[x^2, {x, 0, 1}]", rewrites: [], messages: [] });

/** Mathematica cell code of a body, in order, as the supplier of the cells above. */
function cellsOf(body: string): string[] {
  return [...body.matchAll(/```\{mathematica\}\n([\s\S]*?)\n?```/g)].map((m) => m[1]!);
}

function setup(body: string, opts: { runner?: boolean } = {}): Setup {
  const root = document.createElement("div");
  document.body.append(root);
  const state = { root, calls: [] as Call[], changes: [] as string[], body } as Setup;
  const options: Record<string, unknown> = { body, onChange: (next: string) => { state.changes.push(next); state.body = next; } };
  if (opts.runner !== false) {
    options.onEvalMath = (request: Request, callback: (result: Reply) => void) => { state.calls.push({ request, reply: callback }); };
    options.cellsAbove = () => cellsOf(state.body);
  }
  state.handle = mountQmdEditor(root, options as unknown as Parameters<typeof mountQmdEditor>[1]);
  mounted.push(state.handle);
  return state;
}

/** Replaces the body from outside, as an edit of a cell above arriving from the shared doc would. */
function replaceBody(s: Setup, body: string): void {
  s.body = body;
  s.handle.setBody(body);
}

/** Flushes pending changes until the body satisfies `ok`. */
async function bodyWhere(s: Setup, ok: (body: string) => boolean): Promise<string> {
  await until(() => { s.handle.flush(); return ok(s.body); });
  return s.body;
}

/** Opens the first inline math's LaTeX, sets it, and returns its input. */
function typeMath(s: Setup, tex: string): HTMLInputElement {
  s.root.querySelector<HTMLElement>(".qmd-math-inline .qmd-math-rendered")!.click();
  const input = s.root.querySelector<HTMLInputElement>(".qmd-math-input")!;
  input.value = tex;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return input;
}

function leave(input: HTMLInputElement): void {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}

const undoKey = (s: Setup) => s.root.querySelector(".ProseMirror")!.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));

const typeset = (s: Setup, tex: string): Element | undefined => [...s.root.querySelectorAll("svg")].find((svg) => svg.getAttribute("data-tex") === tex);
const outOfDate = (s: Setup): boolean => s.root.querySelector('[class*="out-of-date"]') !== null || /out of date/i.test(s.root.textContent ?? "");

/** Hovers and focuses a result's element and every ancestor up to the editor surface. */
function hoverAndFocus(s: Setup, el: Element): void {
  const surface = s.root.querySelector(".ProseMirror");
  for (let node: Element | null = el; node && node !== surface; node = node.parentElement) {
    for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove", "focusin"]) node.dispatchEvent(new MouseEvent(type, { bubbles: type !== "mouseenter" && type !== "pointerenter" }));
    if (node.hasAttribute("tabindex")) (node as HTMLElement).focus();
  }
}

const recomputeButton = (): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('button, [role="button"], [role="menuitem"]')].find((b) => /recompute/i.test(`${b.textContent ?? ""} ${b.getAttribute("aria-label") ?? ""}`));

const PLAIN = "Area: $\\int_0^1 x^2\\,dx$\n";
const WITH_CELL = "```{mathematica}\na = 2\n```\n\nValue: $a^2$\n";

/** Leaves `userTex` (ending in `=`), waits so history cannot merge the reply with the typing, replies, and returns the body with the result. */
async function insertResult(s: Setup, userTex: string, latex: string): Promise<string> {
  leave(typeMath(s, userTex));
  await until(() => s.calls.length > 0);
  await settle(600);
  s.calls[s.calls.length - 1]!.reply(value(latex));
  return bodyWhere(s, (b) => b.includes("labshelf-result"));
}

describe("3.3a leaving an inline math that ends with =", () => {
  it("3.3a asks the runner for eval with the expression when the math is left", async () => {
    const s = setup(PLAIN);
    leave(typeMath(s, "\\int_0^1 x^2\\,dx ="));
    await until(() => s.calls.length === 1);
    expect(s.calls[0]!.request.op).toBe("eval");
    expect(s.calls[0]!.request.tex).toContain("\\int_0^1 x^2\\,dx");
    expect(s.calls[0]!.request.tex.trim().endsWith("=")).toBe(false);
  });

  it("3.3a does not ask the runner while the math is still being typed", async () => {
    const s = setup(PLAIN);
    typeMath(s, "\\int_0^1 x^2\\,dx =");
    await settle(200);
    expect(s.calls).toHaveLength(0);
  });

  it("3.3a asks for numeric when the math ends with \\approx", async () => {
    const s = setup(PLAIN);
    leave(typeMath(s, "\\int_0^1 x^2\\,dx \\approx"));
    await until(() => s.calls.length === 1);
    expect(s.calls[0]!.request.op).toBe("numeric");
  });

  it("3.3a asks nothing when the left math does not end with =", async () => {
    const s = setup(PLAIN);
    leave(typeMath(s, "\\int_0^1 x^3\\,dx"));
    await settle(200);
    expect(s.calls).toHaveLength(0);
  });

  it("3.3a inserts the result span after the math, one space between, with engine and a 12 hex source", async () => {
    const s = setup(PLAIN);
    const body = await insertResult(s, "\\int_0^1 x^2\\,dx =", "\\frac{1}{3}");
    expect(body).toMatch(new RegExp(`^Area: \\$\\\\int_0\\^1 x\\^2\\\\,dx =\\$ \\[\\$\\\\frac\\{1\\}\\{3\\}\\$\\]\\{\\.labshelf-result engine=mathematica source=[0-9a-f]{12}\\}\\s*$`));
  });

  it("3.3a shows the inserted result typeset in the sentence", async () => {
    const s = setup(PLAIN);
    await insertResult(s, "\\int_0^1 x^2\\,dx =", "\\frac{1}{3}");
    await until(() => typeset(s, "\\frac{1}{3}") !== undefined);
  });

  it("3.3a one undo removes the result and leaves the math", async () => {
    const s = setup(PLAIN);
    await insertResult(s, "\\int_0^1 x^2\\,dx =", "\\frac{1}{3}");
    undoKey(s);
    const body = await bodyWhere(s, (b) => !b.includes("labshelf-result"));
    expect(body.trimEnd()).toBe("Area: $\\int_0^1 x^2\\,dx =$");
  });

  it("3.3a drops a reply that arrives after the math changed", async () => {
    const s = setup(PLAIN);
    leave(typeMath(s, "\\int_0^1 x^2\\,dx ="));
    await until(() => s.calls.length === 1);
    leave(typeMath(s, "\\int_0^1 x^3\\,dx"));
    s.calls[0]!.reply(value("\\frac{1}{3}"));
    await settle(300);
    s.handle.flush();
    expect(s.body).not.toContain("labshelf-result");
    expect(typeset(s, "\\frac{1}{3}")).toBeUndefined();
  });

  it.each(["failed", "unread"])("3.3a inserts nothing when the reply state is %s", async (state) => {
    const s = setup(PLAIN);
    leave(typeMath(s, "\\int_0^1 x^2\\,dx ="));
    await until(() => s.calls.length === 1);
    s.calls[0]!.reply({ state, readAs: "", rewrites: [], messages: ["could not be read"] });
    await settle(300);
    s.handle.flush();
    expect(s.body).not.toContain("labshelf-result");
  });

  it("3.3a never recomputes on its own when a result already follows the math", async () => {
    const stored = "Area: $\\int_0^1 x^2\\,dx =$ [$\\frac{1}{3}$]{.labshelf-result engine=mathematica source=0123456789ab}\n";
    const s = setup(stored);
    leave(typeMath(s, "\\int_0^1 x^3\\,dx ="));
    await settle(300);
    expect(s.calls).toHaveLength(0);
  });
});

describe("3.3b out of date and Recompute", () => {
  /** A body with a cell above, a result inserted by the trigger, and the supplier reading the current body. */
  async function withResult(): Promise<{ s: Setup; stored: string }> {
    const s = setup(WITH_CELL);
    const stored = await insertResult(s, "a^2 =", "4");
    await until(() => typeset(s, "4") !== undefined);
    return { s, stored };
  }

  it("3.3b a result whose cells above are unchanged is not out of date and offers no Recompute", async () => {
    const { s } = await withResult();
    await settle(300);
    hoverAndFocus(s, typeset(s, "4")!);
    await settle(200);
    expect(outOfDate(s)).toBe(false);
    expect(recomputeButton()).toBeUndefined();
  });

  it("3.3b editing a cell above shows the result out of date", async () => {
    const { s, stored } = await withResult();
    replaceBody(s, stored.replace("a = 2", "a = 3"));
    await until(() => outOfDate(s));
  });

  it("3.3b an out of date result offers Recompute, which asks the runner again", async () => {
    const { s, stored } = await withResult();
    replaceBody(s, stored.replace("a = 2", "a = 3"));
    await until(() => outOfDate(s));
    const before = s.calls.length;
    await until(() => {
      const svg = typeset(s, "4");
      if (svg) hoverAndFocus(s, svg);
      return recomputeButton() !== undefined;
    });
    recomputeButton()!.click();
    await until(() => s.calls.length === before + 1);
    expect(s.calls[before]!.request.op).toBe("eval");
    expect(s.calls[before]!.request.tex).toContain("a^2");
  });

  it("3.3b Recompute replaces the result in one undoable step", async () => {
    const { s, stored } = await withResult();
    replaceBody(s, stored.replace("a = 2", "a = 3"));
    await until(() => outOfDate(s));
    const before = s.calls.length;
    await until(() => {
      const svg = typeset(s, "4");
      if (svg) hoverAndFocus(s, svg);
      return recomputeButton() !== undefined;
    });
    recomputeButton()!.click();
    await until(() => s.calls.length === before + 1);
    await settle(600);
    s.calls[before]!.reply(value("9"));
    const replaced = await bodyWhere(s, (b) => b.includes("[$9$]"));
    expect(replaced).not.toContain("[$4$]");
    expect(replaced.match(/labshelf-result/g)).toHaveLength(1);
    undoKey(s);
    const restored = await bodyWhere(s, (b) => b.includes("[$4$]"));
    expect(restored).not.toContain("[$9$]");
    expect(restored.match(/labshelf-result/g)).toHaveLength(1);
  });

  it("3.3b a recomputed result is current again", async () => {
    const { s, stored } = await withResult();
    replaceBody(s, stored.replace("a = 2", "a = 3"));
    await until(() => outOfDate(s));
    const before = s.calls.length;
    await until(() => {
      const svg = typeset(s, "4");
      if (svg) hoverAndFocus(s, svg);
      return recomputeButton() !== undefined;
    });
    recomputeButton()!.click();
    await until(() => s.calls.length === before + 1);
    s.calls[before]!.reply(value("9"));
    await until(() => typeset(s, "9") !== undefined && !outOfDate(s));
  });

  it("3.3b without onEvalMath the stored result still renders", async () => {
    const s = setup("Area: $\\int_0^1 x^2\\,dx =$ [$\\frac{1}{3}$]{.labshelf-result engine=mathematica source=0123456789ab}\n", { runner: false });
    await until(() => typeset(s, "\\frac{1}{3}") !== undefined);
  });

  it("3.3b without onEvalMath no Recompute is offered even for a result that cannot match its cells", async () => {
    const s = setup("```{mathematica}\na = 2\n```\n\nValue: $a^2 =$ [$4$]{.labshelf-result engine=mathematica source=0123456789ab}\n", { runner: false });
    await until(() => typeset(s, "4") !== undefined);
    await settle(300);
    hoverAndFocus(s, typeset(s, "4")!);
    await settle(200);
    expect(recomputeButton()).toBeUndefined();
  });

  it("3.3b without onEvalMath leaving a math that ends with = inserts nothing", async () => {
    const s = setup(PLAIN, { runner: false });
    leave(typeMath(s, "\\int_0^1 x^2\\,dx ="));
    await settle(300);
    s.handle.flush();
    expect(s.body).not.toContain("labshelf-result");
  });
});

describe("A6 trigger, out of date and no runner", () => {
  it("A6 leaving $x^2 =$ inserts the result and one undo removes it", async () => {
    const s = setup("Square: $x^2$\n");
    const body = await insertResult(s, "x^2 =", "x^{2}");
    expect(body).toMatch(/\$x\^2 =\$ \[\$x\^\{2\}\$\]\{\.labshelf-result engine=mathematica source=[0-9a-f]{12}\}/);
    undoKey(s);
    const after = await bodyWhere(s, (b) => !b.includes("labshelf-result"));
    expect(after.trimEnd()).toBe("Square: $x^2 =$");
  });

  it("A6 a changed cell above shows the result out of date with Recompute", async () => {
    const s = setup(WITH_CELL);
    const stored = await insertResult(s, "a^2 =", "4");
    await until(() => typeset(s, "4") !== undefined);
    replaceBody(s, stored.replace("a = 2", "a = 3"));
    await until(() => outOfDate(s));
    await until(() => {
      const svg = typeset(s, "4");
      if (svg) hoverAndFocus(s, svg);
      return recomputeButton() !== undefined;
    });
  });

  it("A6 without a runner the stored result shows and no Recompute is offered", async () => {
    const s = setup("```{mathematica}\na = 2\n```\n\nValue: $a^2 =$ [$4$]{.labshelf-result engine=mathematica source=0123456789ab}\n", { runner: false });
    await until(() => typeset(s, "4") !== undefined);
    await settle(300);
    hoverAndFocus(s, typeset(s, "4")!);
    await settle(200);
    expect(recomputeButton()).toBeUndefined();
  });
});
