// Tests paper.evalMath: the guard that admits it, and evalPaperMath answering paper.mathResult with the requestId and the runner's result on the paper note's session.
import { evalPaperMath, type LibraryUiHost } from "../../src/libraryUi/paperHandlers";
import { parseUiMessage } from "../../src/libraryUi/protocol/index";

const eval_ = { type: "paper.evalMath", id: "p1", itemId: "n1", requestId: "m1", op: "eval", tex: "\\int_0^1 x\\,dx" };
const RESULT = { state: "value", latex: "\\frac{1}{2}", readAs: "Integrate[x, {x, 0, 1}]", rewrites: [], messages: [] };

function fakeHost(runMath: unknown) {
  const posts: unknown[] = [];
  const host = {
    papers: async () => [], post: (m: unknown) => { posts.push(m); }, notice: () => undefined, refresh: async () => undefined,
    editTags: async () => ({ failed: [] }), trashPapers: async () => ({ done: [], failed: [] }), movePapers: async () => ({ done: [], failed: [] }),
    folderName: () => undefined, details: async () => ({}), runMath,
  } as unknown as LibraryUiHost;
  return { host, posts };
}

describe("paper.evalMath guard", () => {
  it("2.3a accepts a valid paper.evalMath", () => { expect(parseUiMessage(eval_)).toEqual(eval_); });

  it.each(["eval", "numeric", "solve", "check"])("2.3a accepts op %s", (op) => {
    expect(parseUiMessage({ ...eval_, op })).toEqual({ ...eval_, op });
  });

  it("2.3a drops a paper.evalMath with an unknown op", () => { expect(parseUiMessage({ ...eval_, op: "simplify" })).toBeNull(); });

  it.each(["id", "itemId", "requestId", "op", "tex"])("2.3a drops paper.evalMath without %s", (field) => {
    const { [field]: _omitted, ...rest } = eval_ as Record<string, unknown>;
    expect(parseUiMessage(rest)).toBeNull();
  });

  it.each(["id", "itemId", "requestId", "tex"])("2.3a drops paper.evalMath with an empty %s", (field) => {
    expect(parseUiMessage({ ...eval_, [field]: "" })).toBeNull();
  });

  it("2.3a drops paper.evalMath with a non-string tex", () => { expect(parseUiMessage({ ...eval_, tex: 3 })).toBeNull(); });
});

describe("evalPaperMath", () => {
  it("2.3a posts paper.mathResult with the requestId and the runner's result", async () => {
    const { host, posts } = fakeHost(jest.fn(async () => RESULT));
    await evalPaperMath(host, { id: "p1", itemId: "n1", requestId: "m1", op: "eval", tex: "\\int_0^1 x\\,dx" });
    expect(posts).toEqual([{ type: "paper.mathResult", requestId: "m1", result: RESULT }]);
  });

  it("A4 runs the request on the paper note's session with its op and tex", async () => {
    const runMath = jest.fn(async (_request: { noteKey: string; op: string; tex: string }) => RESULT);
    const { host } = fakeHost(runMath);
    await evalPaperMath(host, { id: "p1", itemId: "n1", requestId: "m1", op: "numeric", tex: "\\pi" });
    expect(runMath).toHaveBeenCalledTimes(1);
    expect(runMath.mock.calls[0]![0]).toEqual(expect.objectContaining({ noteKey: "paper:p1", op: "numeric", tex: "\\pi" }));
  });

  it("2.3a answers each request with its own requestId", async () => {
    const { host, posts } = fakeHost(jest.fn(async (request: { tex: string }) => ({ ...RESULT, readAs: request.tex })));
    await evalPaperMath(host, { id: "p1", itemId: "n1", requestId: "m1", op: "eval", tex: "a" });
    await evalPaperMath(host, { id: "p1", itemId: "n1", requestId: "m2", op: "eval", tex: "b" });
    expect(posts).toEqual([
      { type: "paper.mathResult", requestId: "m1", result: { ...RESULT, readAs: "a" } },
      { type: "paper.mathResult", requestId: "m2", result: { ...RESULT, readAs: "b" } },
    ]);
  });

  it("2.3a passes a differs result through with its counterexample untouched", async () => {
    const differs = { state: "differs", readAs: "x", rewrites: [], messages: [], counterexample: { point: { x: 2 }, lhs: "3", rhs: "4" } };
    const { host, posts } = fakeHost(jest.fn(async () => differs));
    await evalPaperMath(host, { id: "p1", itemId: "n1", requestId: "m1", op: "check", tex: "x+1=x+2" });
    expect(posts).toEqual([{ type: "paper.mathResult", requestId: "m1", result: differs }]);
  });
});
