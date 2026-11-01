/** Pins helper protocol 11: evalMath runs the host's runMath and is answered with mathResult under its id, the tex is capped at 8 KiB, the client sends it without ever cancelling, and a version 10 page is refused. */
import { HELPER_VERSION, PROTOCOL_VERSION, createNativeLatexHelper, parseHelperMessage } from "../../src/helper/index";
import { createHelperAnswerer, type HelperHandlers } from "../../src/helper/node/helperHandlers";
import { createCellHandlers } from "../../src/helper/node/runHelperHost";
import type { ICellRunner } from "../../src/qmd/compute/cellRunner";
import type { ILogger } from "../../src/ports/index";
import { fakeLogger, FakeHelper } from "./fakeHelperClient";

const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}), redact: jest.fn() } as unknown as ILogger;
const CWD = "/work/thesis";
const resolveCwd = (scope: string): string | undefined => (scope === "thesis" ? CWD : undefined);

const env = (id: string) => ({ v: PROTOCOL_VERSION, id });
const evalRaw = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ ...env("math-1"), type: "evalMath", noteKey: "paper:p1", cwd: "thesis", op: "eval", tex: "\\frac{x^2-1}{x-1}", ...over });
const resultRaw = (result: Record<string, unknown>, id = "math-1"): Record<string, unknown> => ({ ...env(id), type: "mathResult", result });
const rejection = (raw: unknown, direction: "toHelper" | "toPage" = "toHelper") => {
  const result = parseHelperMessage(raw, direction);
  return result.ok ? undefined : result.code;
};
const roundTrip = (message: object): unknown => JSON.parse(JSON.stringify(message));

const PROVED = { state: "proved", readAs: "x^2 == x^2", rewrites: [], messages: [] };

interface MathCall { request: Record<string, unknown>; extra: unknown[] }

/** A runner whose runMath finishes only when `finish` is called, and records what it was asked. */
function fakeRunner() {
  const calls: MathCall[] = [];
  const finishers: Array<(result: unknown) => void> = [];
  const failers: Array<(error: Error) => void> = [];
  const runner = {
    runMath: (request: Record<string, unknown>, ...extra: unknown[]) => new Promise((resolve, reject) => {
      calls.push({ request, extra });
      finishers.push(resolve);
      failers.push(reject);
    }),
    run: jest.fn(async () => ({ status: "ok", language: "python", durationMs: 1 })),
    restart: jest.fn(async () => {}),
    dispose: jest.fn(async () => {}),
  } as unknown as ICellRunner;
  return { runner, calls, finish: (result: unknown) => finishers.shift()?.(result), fail: (error: Error) => failers.shift()?.(error) };
}

function setup() {
  const fake = fakeRunner();
  const cells = createCellHandlers({ runner: fake.runner, resolveCwd, logger }) as unknown as Record<string, unknown>;
  const sent: Array<Record<string, unknown>> = [];
  const handlers = { evalMath: cells.evalMath } as unknown as HelperHandlers;
  const dispatcher = createHelperAnswerer(handlers, logger);
  const handle = (envelope: unknown) => dispatcher.handle(envelope as Record<string, unknown>, new Uint8Array(), (m) => { sent.push(m as unknown as Record<string, unknown>); });
  return { ...fake, cells, sent, handle, drain: () => dispatcher.drain() };
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) { await new Promise((resolve) => setTimeout(resolve, 5)); }
}

async function connected() {
  const fake = new FakeHelper();
  const helper = createNativeLatexHelper({ logger: fakeLogger(), extensionVersion: "0.1.0", origin: "chrome-extension://abc", connectNative: () => fake, openSocket: fake.openSocket });
  await helper.connect();
  return { fake, helper: helper as unknown as { evalMath(request: Record<string, unknown>, signal: AbortSignal): Promise<unknown> } };
}

describe("2.1a evalMath message", () => {
  it.each(["eval", "numeric", "solve", "check"])("2.1a reads an evalMath with op %s sent to the helper", (op) => {
    const raw = evalRaw({ op });
    expect(parseHelperMessage(roundTrip(raw), "toHelper")).toEqual({ ok: true, message: raw });
  });

  it("2.1a rejects an evalMath with an op outside eval, numeric, solve and check", () => {
    expect(rejection(evalRaw({ op: "integrate" }))).toBe("invalid-field");
  });

  it("2.1a rejects an evalMath without an op", () => {
    const raw = evalRaw();
    delete raw.op;
    expect(rejection(raw)).toBe("invalid-field");
  });

  it("2.1a rejects an evalMath without a note key", () => {
    const raw = evalRaw();
    delete raw.noteKey;
    expect(rejection(raw)).toBe("invalid-field");
  });

  it("2.1a accepts a note key of 512 characters and rejects one of 513", () => {
    expect(parseHelperMessage(evalRaw({ noteKey: "k".repeat(512) }), "toHelper").ok).toBe(true);
    expect(rejection(evalRaw({ noteKey: "k".repeat(513) }))).toBeDefined();
  });

  it("2.1a rejects an evalMath without a cwd", () => {
    const raw = evalRaw();
    delete raw.cwd;
    expect(rejection(raw)).toBeDefined();
  });

  it("2.1a rejects an evalMath without tex", () => {
    const raw = evalRaw();
    delete raw.tex;
    expect(rejection(raw)).toBeDefined();
  });

  it("2.1a accepts a tex of 8192 bytes", () => {
    expect(parseHelperMessage(evalRaw({ tex: "x".repeat(8192) }), "toHelper").ok).toBe(true);
  });

  it("2.1a refuses a tex of 8193 bytes with limit", () => {
    expect(rejection(evalRaw({ tex: "x".repeat(8193) }))).toBe("limit");
  });

  it("2.1a counts the tex cap in UTF-8 bytes, not characters", () => {
    expect(rejection(evalRaw({ tex: "é".repeat(4097) }))).toBe("limit");
  });

  it("2.1a keeps the id of a refused evalMath so the reply can pair with it", () => {
    expect(parseHelperMessage(evalRaw({ id: "math-big", tex: "x".repeat(9000) }), "toHelper")).toMatchObject({ ok: false, code: "limit", id: "math-big" });
  });

  it.each(["value", "proved", "sampled", "differs", "conditional", "unread", "failed"])("2.1a reads a mathResult in state %s sent to the page", (state) => {
    const raw = resultRaw({ state, latex: "x+1", readAs: "x + 1", rewrites: [], messages: ["note"] });
    expect(parseHelperMessage(roundTrip(raw), "toPage")).toEqual({ ok: true, message: raw });
  });

  it("2.1a reads the counterexample and condition of a mathResult", () => {
    const differs = resultRaw({ state: "differs", readAs: "a == b", rewrites: [], messages: [], counterexample: { point: { x: 1.5, y: 2 }, lhs: "3", rhs: "4" } });
    const conditional = resultRaw({ state: "conditional", readAs: "a == b", rewrites: [], messages: [], condition: "x > 0" });
    expect(parseHelperMessage(roundTrip(differs), "toPage")).toEqual({ ok: true, message: differs });
    expect(parseHelperMessage(roundTrip(conditional), "toPage")).toEqual({ ok: true, message: conditional });
  });

  it("2.1a refuses a mathResult whose state is not one the page knows", () => {
    expect(rejection(resultRaw({ ...PROVED, state: "maybe" }), "toPage")).toBe("invalid-field");
  });

  it("2.1a refuses a mathResult without a result", () => {
    expect(rejection({ ...env("math-1"), type: "mathResult" }, "toPage")).toBe("invalid-field");
  });

  it("2.1a runs runMath on the host with the note key, op and tex and answers mathResult under the envelope id", async () => {
    const h = setup();
    h.handle(evalRaw({ id: "math-7", noteKey: "space:s1:notes/a.qmd", op: "check", tex: "a=b" }));
    await until(() => h.calls.length === 1);
    expect(h.calls[0]!.request).toMatchObject({ noteKey: "space:s1:notes/a.qmd", op: "check", tex: "a=b" });
    const result = { state: "sampled", readAs: "a == b", rewrites: [], messages: ["12 points"] };
    h.finish(result);
    await h.drain();
    expect(h.sent).toEqual([{ v: PROTOCOL_VERSION, id: "math-7", type: "mathResult", result }]);
  });

  it("2.1a carries the runner's result through as is, counterexample included", async () => {
    const h = setup();
    h.handle(evalRaw({ id: "math-8", op: "check" }));
    await until(() => h.calls.length === 1);
    const result = { state: "differs", readAs: "a == b", rewrites: [], messages: [], counterexample: { point: { x: 0.5 }, lhs: "1", rhs: "2" } };
    h.finish(result);
    await h.drain();
    expect(h.sent).toEqual([{ v: PROTOCOL_VERSION, id: "math-8", type: "mathResult", result }]);
  });

  it("2.1a answers two evalMath messages each under its own id", async () => {
    const h = setup();
    h.handle(evalRaw({ id: "m-a", tex: "1+1" }));
    await until(() => h.calls.length === 1);
    h.finish({ ...PROVED, state: "value", latex: "2" });
    h.handle(evalRaw({ id: "m-b", tex: "2+2" }));
    await until(() => h.calls.length === 2);
    h.finish({ ...PROVED, state: "value", latex: "4" });
    await h.drain();
    expect(h.sent.map((m) => [m.id, m.type, (m.result as { latex: string }).latex])).toEqual([["m-a", "mathResult", "2"], ["m-b", "mathResult", "4"]]);
  });

  it("2.1a does not abort the runner's request while it is in flight", async () => {
    const h = setup();
    h.handle(evalRaw({ id: "math-9" }));
    await until(() => h.calls.length === 1);
    const signals = [h.calls[0]!.request.signal, ...h.calls[0]!.extra].filter((x): x is AbortSignal => x instanceof AbortSignal);
    h.finish(PROVED);
    await h.drain();
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
  });

  it("2.1a answers an error reply under the id when runMath throws", async () => {
    const h = setup();
    h.handle(evalRaw({ id: "math-10" }));
    await until(() => h.calls.length === 1);
    h.fail(new Error("kernel gone"));
    await h.drain();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ id: "math-10", type: "error" });
  });

  it("2.1a sends the evalMath through the client and returns the mathResult as is", async () => {
    const { fake, helper } = await connected();
    const pending = helper.evalMath({ noteKey: "paper:p1", cwd: "paper:p1", op: "numeric", tex: "\\pi" }, new AbortController().signal);
    await until(() => fake.receivedOfType("evalMath").length === 1);
    const sentMath = fake.receivedOfType("evalMath")[0]!;
    expect(sentMath).toMatchObject({ type: "evalMath", noteKey: "paper:p1", cwd: "paper:p1", op: "numeric", tex: "\\pi" });
    const result = { state: "value", latex: "3.14159", readAs: "Pi", rewrites: [], messages: [] };
    fake.sockets[0]!.deliver({ id: sentMath.id, type: "mathResult", result });
    expect(await pending).toEqual(result);
  });

  it("2.1a never posts cancelCell when the signal aborts a request in flight", async () => {
    const { fake, helper } = await connected();
    const controller = new AbortController();
    const pending = helper.evalMath({ noteKey: "paper:p1", cwd: "paper:p1", op: "eval", tex: "1+1" }, controller.signal);
    pending.catch(() => undefined);
    await until(() => fake.receivedOfType("evalMath").length === 1);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.receivedOfType("cancelCell")).toEqual([]);
  });

  it("2.1a drops the reply of an aborted request: the caller never receives the result", async () => {
    const { fake, helper } = await connected();
    const controller = new AbortController();
    const pending = helper.evalMath({ noteKey: "paper:p1", cwd: "paper:p1", op: "eval", tex: "1+1" }, controller.signal);
    const outcome = pending.then(() => "value", () => "settled-without-value");
    await until(() => fake.receivedOfType("evalMath").length === 1);
    controller.abort();
    fake.sockets[0]!.deliver({ id: fake.receivedOfType("evalMath")[0]!.id, type: "mathResult", result: PROVED });
    const settled = await Promise.race([outcome, new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 50))]);
    expect(settled).not.toBe("value");
  });
});

describe("2.1b protocol version", () => {
  it("2.1b is protocol version 11", () => { expect(PROTOCOL_VERSION).toBe(11); });

  it("2.1b raises the helper's minor version from 0.4.0", () => { expect(HELPER_VERSION).toBe("0.5.0"); });

  it("2.1b refuses a version 10 evalMath with a version rejection that reports the received version", () => {
    const result = parseHelperMessage({ ...evalRaw({ id: "old-1" }), v: 10 }, "toHelper");
    expect(result).toMatchObject({ ok: false, code: "version", id: "old-1", received: 10 });
  });

  it("2.1b refuses a version 10 runCell, so an old page is refused whatever it sends", () => {
    expect(rejection({ v: 10, id: "old-2", type: "runCell", code: "1", cwd: "thesis", timeoutMs: 1000, language: "python", noteKey: "n" })).toBe("version");
  });

  it("2.1b makes a client built for protocol 11 speak v 11 in the evalMath it posts", async () => {
    const { fake, helper } = await connected();
    void helper.evalMath({ noteKey: "paper:p1", cwd: "paper:p1", op: "eval", tex: "x" }, new AbortController().signal).catch(() => undefined);
    await until(() => fake.receivedOfType("evalMath").length === 1);
    expect(fake.receivedOfType("evalMath")[0]!.v).toBe(11);
  });
});

describe("A4 evalMath reaches the session through the Helper", () => {
  it("A4 round-trips the client's evalMath through the host handler table to the runner's runMath and back to the caller on protocol 11", async () => {
    const { fake, helper } = await connected();
    const h = setup();
    const pending = helper.evalMath({ noteKey: "paper:p1", cwd: "thesis", op: "check", tex: "a=b" }, new AbortController().signal);
    await until(() => fake.receivedOfType("evalMath").length === 1);
    const frame = fake.receivedOfType("evalMath")[0]!;
    expect(frame.v).toBe(11);
    // The socket frame goes through the helper's parser, then the dispatcher and its handler table, as on the real host.
    const parsed = parseHelperMessage(frame, "toHelper");
    expect(parsed.ok).toBe(true);
    h.handle(frame);
    await until(() => h.calls.length === 1);
    expect(h.calls[0]!.request).toMatchObject({ noteKey: "paper:p1", op: "check", tex: "a=b" });
    const result = { state: "sampled", readAs: "a == b", rewrites: [], messages: ["12 points"] };
    h.finish(result);
    await h.drain();
    expect(h.sent).toHaveLength(1);
    const reply = h.sent[0]!;
    expect(reply).toMatchObject({ v: 11, id: frame.id, type: "mathResult" });
    expect(parseHelperMessage(roundTrip(reply), "toPage").ok).toBe(true);
    fake.sockets[0]!.deliver({ id: reply.id, type: reply.type, result: reply.result });
    expect(await pending).toEqual(result);
  });
});
