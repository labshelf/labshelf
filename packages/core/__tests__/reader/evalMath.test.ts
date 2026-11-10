// Tests the reader's evalMath -> mathResult: the validator, the host answering with the same requestId and the runner's result, and the paper note's session key.
import { isWebviewMessage, PROTOCOL_VERSION } from "../../src/reader/protocol/index";
import { PaperNotesStore, type HostToWebview } from "@labshelf/core";
import { setupHost } from "./hostFixture";

interface MathResultShape {
  state: string;
  latex?: string;
  readAs?: string;
  rewrites: string[];
  messages: string[];
  counterexample?: { point: Record<string, number>; lhs: string; rhs: string };
}
interface MathRequestShape { noteKey: string; op: string; tex: string }
type RunMath = (request: MathRequestShape, signal?: AbortSignal) => Promise<MathResultShape>;
type MathReply = { type: "mathResult"; requestId: string; result: MathResultShape };

const valid = { command: "evalMath", requestId: "m1", itemId: "n-01JB2QN0000000000000000000", op: "eval", tex: "\\int_0^1 x\\,dx" };

const PROVED: MathResultShape = { state: "proved", readAs: "Equal[x, x]", rewrites: [], messages: [] };
const DIFFERS: MathResultShape = {
  state: "differs",
  readAs: "Equal[Plus[x, 1], Plus[x, 2]]",
  rewrites: ["leibniz"],
  messages: ["note one"],
  counterexample: { point: { x: 2 }, lhs: "3", rhs: "4" },
};

function setup(runMath?: RunMath) {
  const base = setupHost();
  const files: Record<string, string> = {};
  const notes = new PaperNotesStore({ read: async (id) => files[id] ?? null, write: async (id, text) => { files[id] = text; } }, { logger: base.ports.logger });
  Object.assign(base.ports, { notes, ...(runMath ? { runMath } : {}) });
  const replies = (): MathReply[] => base.posted.filter((m: HostToWebview) => (m as { type: string }).type === "mathResult") as unknown as MathReply[];
  return { ...base, files, replies };
}

const send = (host: { handle(m: never): Promise<void> | void }, message: unknown) => host.handle(message as never);

describe("reader evalMath guard", () => {
  it("2.2a the reader protocol version rises from 10 to 11", () => {
    expect(PROTOCOL_VERSION).toBe(13);
  });

  it("2.2a accepts a valid evalMath", () => {
    expect(isWebviewMessage(valid)).toBe(true);
  });

  it.each(["eval", "numeric", "solve", "check"])("2.2a accepts evalMath with op %s", (op) => {
    expect(isWebviewMessage({ ...valid, op })).toBe(true);
  });

  it.each(["simplify", "run", "", "EVAL", "shell"])("2.2a refuses evalMath with the invalid op %j", (op) => {
    expect(isWebviewMessage({ ...valid, op })).toBe(false);
  });

  it.each([1, null, undefined, {}])("2.2a refuses evalMath whose op is %j", (op) => {
    expect(isWebviewMessage({ ...valid, op })).toBe(false);
  });

  it("2.2a refuses evalMath without an op", () => {
    const { op: _gone, ...rest } = valid;
    expect(isWebviewMessage(rest)).toBe(false);
  });

  it("2.2a refuses evalMath without a requestId", () => {
    const { requestId: _gone, ...rest } = valid;
    expect(isWebviewMessage(rest)).toBe(false);
  });

  it("2.2a refuses evalMath with an empty requestId", () => {
    expect(isWebviewMessage({ ...valid, requestId: "" })).toBe(false);
  });

  it("2.2a refuses evalMath without a tex", () => {
    const { tex: _gone, ...rest } = valid;
    expect(isWebviewMessage(rest)).toBe(false);
  });

  it.each([42, null, ["x"], { tex: "x" }])("2.2a refuses evalMath whose tex is %j", (tex) => {
    expect(isWebviewMessage({ ...valid, tex })).toBe(false);
  });
});

describe("reader evalMath host", () => {
  it("2.2a answers mathResult with the same requestId and the runner's result", async () => {
    const { host, replies } = setup(async () => DIFFERS);
    await send(host, valid);
    expect(replies()).toEqual([{ type: "mathResult", requestId: "m1", result: DIFFERS }]);
  });

  it("A4 a reader page's evalMath through the host dispatch reaches the runMath port and comes back as mathResult", async () => {
    const runMath = jest.fn<ReturnType<RunMath>, Parameters<RunMath>>(async () => PROVED);
    const { host, replies } = setup(runMath);
    await send(host, { ...valid, requestId: "a4" });
    expect(runMath).toHaveBeenCalledTimes(1);
    expect(replies()).toEqual([{ type: "mathResult", requestId: "a4", result: PROVED }]);
  });

  it("2.2a hands the runner the op and tex and the paper note's session key", async () => {
    const runMath = jest.fn<ReturnType<RunMath>, Parameters<RunMath>>(async () => PROVED);
    const { host } = setup(runMath);
    await send(host, { ...valid, op: "check", tex: "a=b" });
    expect(runMath).toHaveBeenCalledTimes(1);
    expect(runMath.mock.calls[0]![0]).toMatchObject({ noteKey: "paper:p1", op: "check", tex: "a=b" });
  });

  it("2.2a keeps two requests apart by their requestIds", async () => {
    const { host, replies } = setup(async (request) => (request.tex === "slow" ? { ...DIFFERS } : { ...PROVED }));
    await Promise.all([
      send(host, { ...valid, requestId: "a", tex: "slow" }),
      send(host, { ...valid, requestId: "b", tex: "fast" }),
    ]);
    const byId = new Map(replies().map((r) => [r.requestId, r.result.state]));
    expect(byId).toEqual(new Map([["a", "differs"], ["b", "proved"]]));
  });

  it("2.2a writes nothing to the notes file", async () => {
    const { host, files } = setup(async () => PROVED);
    await send(host, valid);
    expect(files).toEqual({});
  });

  it("2.2a does not post cellState for a math request", async () => {
    const { host, posted } = setup(async () => PROVED);
    await send(host, valid);
    expect(posted.filter((m: HostToWebview) => m.type === "cellState")).toEqual([]);
  });

  it("2.2a tells the page it can run cells when the host has only a math runner", async () => {
    const { host, posted } = setup(async () => PROVED);
    await send(host, { command: "ready-for-init" });
    const init = posted.find((m: HostToWebview) => m.type === "init") as { canRunCells?: boolean } | undefined;
    expect(init?.canRunCells).toBe(true);
  });

  it("2.2a leaves canRunCells off when the host has neither runner", async () => {
    const { host, posted } = setup();
    await send(host, { command: "ready-for-init" });
    const init = posted.find((m: HostToWebview) => m.type === "init") as { canRunCells?: boolean } | undefined;
    expect(init?.canRunCells ?? false).toBe(false);
  });
});
