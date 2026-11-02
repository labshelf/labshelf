/** @jest-environment jsdom */
// Tests the background step check of the QMD editor (plan math-in-prose D9) through mountQmdEditor, with a fake
// onEvalMath and jest fake timers. The spec fixes no seam beyond the mount API, so the assumptions are:
//  - options.onEvalMath(request, callback) is called with a request carrying { op: "check", tex } where tex is one
//    step "lhs = rhs" (compared here with whitespace and the aligned-line `&` removed), and the host answers with
//    callback(result), result being the D4 shape { state, readAs, rewrites, messages };
//  - a user edit is typing in the math's own TeX field (the `.qmd-math-input` shown when the typeset math is clicked);
//  - setBody is not a user edit (a collab mount cannot be built under jsdom today: ySyncPlugin dispatches during EditorView construction);
//  - plugin state is not readable from outside, so "never written" is observed as onChange staying silent.
import { mountQmdEditor, type QmdEditorHandle } from "../../../src/qmd/dom/qmdEditor";

// MathJax is not loaded: the math view renders through a stub.
jest.mock("../../../src/latex/hover/index", () => ({
  __esModule: true,
  renderMathSvg: () => '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"></svg>',
}));

const DEBOUNCE_MS = 800;
// Taken before fake timers are installed, so real asynchronous work (a hash, say) can be waited for.
const realSetTimeout = globalThis.setTimeout;
const realWait = (ms: number) => new Promise<void>((resolve) => { realSetTimeout(resolve, ms); });

/** Lets promises and real asynchronous work started by the editor finish while the fake clock stands still. */
async function settle(): Promise<void> {
  for (let i = 0; i < 15; i++) await realWait(2);
}

async function advance(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await settle();
}

interface Call { request: { op: string; tex: string }; reply(result?: Record<string, unknown>): void }

const PROVED = { state: "proved", readAs: "a == b", rewrites: [], messages: [] };

function fakeRunner() {
  const calls: Call[] = [];
  const onEvalMath = jest.fn((request: Call["request"], callback: (result: unknown) => void) => {
    calls.push({ request, reply: (result = PROVED) => callback(result) });
  });
  return { calls, onEvalMath };
}

/** The step text a request asks about, without spaces or aligned-line ampersands. */
const stepOf = (call: Call): string => call.request.tex.replace(/[\s&]/g, "");

interface Setup { root: HTMLElement; handle: QmdEditorHandle; changes: string[]; calls: Call[]; onEvalMath: jest.Mock }
let mounted: QmdEditorHandle[] = [];

function setup(body: string, extra: { readOnly?: boolean; runner?: boolean } = {}): Setup {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const changes: string[] = [];
  const { calls, onEvalMath } = fakeRunner();
  const options = {
    body,
    onChange: (next: string) => changes.push(next),
    readOnly: extra.readOnly,
    ...(extra.runner === false ? {} : { onEvalMath }),
  };
  const handle = mountQmdEditor(root, options as Parameters<typeof mountQmdEditor>[1]);
  mounted.push(handle);
  return { root, handle, changes, calls, onEvalMath };
}

/** Types `tex` into the TeX field of the `index`-th math (opening the field by clicking the typeset math). */
function editMath(root: HTMLElement, index: number, tex: string): void {
  const math = root.querySelectorAll<HTMLElement>(".qmd-math")[index];
  if (!math) throw new Error(`no math ${index}`);
  let input = math.querySelector<HTMLInputElement | HTMLTextAreaElement>(".qmd-math-input");
  if (!input) {
    math.querySelector(".qmd-math-rendered")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    input = math.querySelector<HTMLInputElement | HTMLTextAreaElement>(".qmd-math-input");
  }
  if (!input) throw new Error("the TeX field did not open");
  input.value = tex;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => { jest.useFakeTimers(); });

afterEach(() => {
  for (const handle of mounted) { try { handle.destroy(); } catch { /* already destroyed */ } }
  mounted = [];
  document.body.innerHTML = "";
  jest.useRealTimers();
});

const ONE = "Text $a=b$ end\n";
const TWO = "First $a=b$ and second $c=d$ end\n";
const ALIGNED = "Intro\n\n$$a &= b \\\\ &= c$$\n\nOutro\n";

describe("math step checks", () => {
  it("4.2a opening a note sends no check", async () => {
    const { calls } = setup(`${ONE}\n$$a &= b \\\\ &= c$$\n`);
    await advance(10 * DEBOUNCE_MS);
    expect(calls).toHaveLength(0);
  });

  it("4.2a opening a note with several maths sends no check even after a long time", async () => {
    const { calls, handle } = setup(TWO);
    handle.focus();
    await advance(60_000);
    expect(calls).toHaveLength(0);
  });

  it("4.2a sends no check before 800 ms have passed since the edit", async () => {
    const { root, calls } = setup(ONE);
    editMath(root, 0, "a=c");
    await advance(DEBOUNCE_MS - 1);
    expect(calls).toHaveLength(0);
  });

  it("4.2a sends a check for the edited step once 800 ms have passed", async () => {
    const { root, calls } = setup(ONE);
    editMath(root, 0, "a=c");
    await advance(DEBOUNCE_MS);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.request.op).toBe("check");
    expect(stepOf(calls[0]!)).toBe("a=c");
  });

  it("4.2a three edits within 800 ms of each other send one check", async () => {
    const { root, calls } = setup(ONE);
    editMath(root, 0, "a=c");
    await advance(300);
    editMath(root, 0, "a=d");
    await advance(300);
    editMath(root, 0, "a=e");
    await advance(DEBOUNCE_MS - 1);
    expect(calls).toHaveLength(0);
    await advance(1);
    expect(calls).toHaveLength(1);
  });

  it("4.2a the one check after three edits is for the last text", async () => {
    const { root, calls } = setup(ONE);
    editMath(root, 0, "a=c");
    await advance(300);
    editMath(root, 0, "a=d");
    await advance(300);
    editMath(root, 0, "a=e");
    await advance(DEBOUNCE_MS);
    await advance(5 * DEBOUNCE_MS);
    expect(calls.map(stepOf)).toEqual(["a=e"]);
  });

  it("4.2a a math with two steps sends one check per step", async () => {
    const { root, calls } = setup(ONE);
    editMath(root, 0, "a=c=d");
    await advance(DEBOUNCE_MS);
    expect(calls.map(stepOf).sort()).toEqual(["a=c", "c=d"]);
  });

  it("4.2a an `=` inside a subscript or braces is not a step", async () => {
    const { root, calls } = setup(ONE);
    editMath(root, 0, "\\sum_{k=0}^{n} a = b");
    await advance(DEBOUNCE_MS);
    expect(calls).toHaveLength(1);
    // Once the braced groups are removed a single top-level `=` is left.
    expect(calls[0]!.request.tex.replace(/\{[^{}]*\}/g, "").match(/=/g)).toHaveLength(1);
  });

  it("4.2a an edit after a check was sent sends a new check for the new text", async () => {
    const { root, calls } = setup(ONE);
    editMath(root, 0, "a=c");
    await advance(DEBOUNCE_MS);
    editMath(root, 0, "a=d");
    await advance(DEBOUNCE_MS);
    expect(calls.map(stepOf)).toEqual(["a=c", "a=d"]);
  });

  it("4.2a a reply for an older text neither throws nor sends anything more", async () => {
    const { root, calls } = setup(ONE);
    editMath(root, 0, "a=c");
    await advance(DEBOUNCE_MS);
    editMath(root, 0, "a=d");
    await advance(DEBOUNCE_MS);
    expect(() => calls[0]!.reply({ state: "differs", readAs: "a == c", rewrites: [], messages: [], counterexample: { point: { a: 1 }, lhs: "1", rhs: "2" } })).not.toThrow();
    await advance(10 * DEBOUNCE_MS);
    expect(calls).toHaveLength(2);
  });

  it("4.2a the document is not changed by checks or their replies", async () => {
    const { root, calls, changes, handle } = setup(ONE);
    editMath(root, 0, "a=c");
    await advance(DEBOUNCE_MS);
    handle.flush();
    const before = changes.slice();
    expect(before.length).toBeGreaterThan(0);
    expect(before[before.length - 1]).toBe("Text $a=c$ end\n");
    calls[0]!.reply({ state: "differs", readAs: "a == c", rewrites: [], messages: ["m"], counterexample: { point: { a: 1 }, lhs: "1", rhs: "2" } });
    await advance(10 * DEBOUNCE_MS);
    handle.flush();
    expect(changes).toEqual(before);
  });

  it("4.2a a reply does not put a result span or any marker text into the body", async () => {
    const { root, calls, changes, handle } = setup(ONE);
    editMath(root, 0, "a=c");
    await advance(DEBOUNCE_MS);
    calls[0]!.reply();
    await advance(DEBOUNCE_MS);
    handle.flush();
    const last = changes[changes.length - 1]!;
    expect(last).not.toContain("labshelf-result");
    expect(last).toBe("Text $a=c$ end\n");
  });

  it("A7 only the edited math is checked, not its untouched neighbour", async () => {
    const { root, calls } = setup(TWO);
    editMath(root, 1, "c=e");
    await advance(DEBOUNCE_MS);
    expect(calls.map(stepOf)).toEqual(["c=e"]);
  });

  it("A7 edits to two different maths each get their own check", async () => {
    const { root, calls } = setup(TWO);
    editMath(root, 0, "a=x");
    await advance(100);
    editMath(root, 1, "c=y");
    await advance(DEBOUNCE_MS);
    expect(calls.map(stepOf).sort()).toEqual(["a=x", "c=y"]);
  });

  it("A7 an edit to another math does not delay the check of the first", async () => {
    const { root, calls } = setup(TWO);
    editMath(root, 0, "a=x");
    await advance(500);
    editMath(root, 1, "c=y");
    await advance(300);
    expect(calls.map(stepOf)).toEqual(["a=x"]);
  });

  it("A7 an aligned display chains its lines into one check per step", async () => {
    const { root, calls } = setup(ALIGNED);
    editMath(root, 0, "a &= z \\\\ &= c");
    await advance(DEBOUNCE_MS);
    expect(calls.map(stepOf).sort()).toEqual(["a=z", "z=c"]);
  });

  it("A7 a step already answered is not sent again when its text comes back", async () => {
    const { root, calls } = setup(ONE);
    editMath(root, 0, "a=c");
    await advance(DEBOUNCE_MS);
    calls[0]!.reply();
    await settle();
    editMath(root, 0, "a=d");
    await advance(DEBOUNCE_MS);
    calls[1]!.reply();
    await settle();
    editMath(root, 0, "a=c");
    await advance(DEBOUNCE_MS);
    await advance(5 * DEBOUNCE_MS);
    expect(calls.map(stepOf)).toEqual(["a=c", "a=d"]);
  });

  it("A7 a body replaced through setBody is not checked", async () => {
    const { calls, handle } = setup(ONE);
    handle.setBody("Other $p=q$ text\n");
    await advance(10 * DEBOUNCE_MS);
    expect(calls).toHaveLength(0);
  });

  it("A7 a read-only editor sends no check when its body is replaced", async () => {
    const { calls, handle } = setup(ONE, { readOnly: true });
    handle.setBody("Other $p=q$ text\n");
    await advance(10 * DEBOUNCE_MS);
    expect(calls).toHaveLength(0);
  });

  it("A7 a read-only editor sends no check on a click on its math", async () => {
    const { root, calls } = setup(ONE, { readOnly: true });
    root.querySelector(".qmd-math-rendered")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await advance(10 * DEBOUNCE_MS);
    expect(calls).toHaveLength(0);
  });

  it("A7 an editor without onEvalMath still reports an edit and sends nothing", async () => {
    const { root, calls, changes, handle } = setup(ONE, { runner: false });
    editMath(root, 0, "a=c");
    await advance(DEBOUNCE_MS);
    handle.flush();
    expect(changes[changes.length - 1]).toBe("Text $a=c$ end\n");
    expect(calls).toHaveLength(0);
  });
});
