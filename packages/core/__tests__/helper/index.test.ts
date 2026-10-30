/** Pins the guards for the cell messages: runCell and cancelCell to the helper, cellResult back, their input limits and the protocol version. */
import { PROTOCOL_VERSION, parseHelperMessage, type ToHelperMessage, type ToPageMessage } from "../../src/helper/index";

const env = (id: string) => ({ v: PROTOCOL_VERSION, id });
const run = (over: Record<string, unknown> = {}) => ({ ...env("run-1"), type: "runCell", code: "print(1)", cwd: "thesis", timeoutMs: 60_000, ...over });
const cancel = (over: Record<string, unknown> = {}) => ({ ...env("c-1"), type: "cancelCell", requestId: "run-1", ...over });
const rejection = (raw: unknown, direction: "toHelper" | "toPage" = "toHelper") => {
  const result = parseHelperMessage(raw, direction);
  return result.ok ? undefined : result.code;
};
const roundTrip = (message: object): unknown => JSON.parse(JSON.stringify(message));

describe("12.4a runCell guard", () => {
  it("12.4a accepts a valid runCell", () => {
    const message = run() as unknown as ToHelperMessage;
    expect(parseHelperMessage(roundTrip(message), "toHelper")).toEqual({ ok: true, message });
  });

  it("12.4a accepts multi-line code", () => {
    expect(parseHelperMessage(run({ code: "import sympy\nx = sympy.Symbol('x')\nprint(x**2)\n" }), "toHelper").ok).toBe(true);
  });

  it.each(["code", "cwd", "timeoutMs"])("12.4a refuses a runCell without %s", (field) => {
    const raw: Record<string, unknown> = run();
    delete raw[field];
    expect(rejection(raw)).toBeDefined();
  });

  it("12.4a refuses code that is not a string", () => {
    expect(rejection(run({ code: 42 }))).toBeDefined();
  });

  it("12.4a refuses oversized code as a limit", () => {
    expect(rejection(run({ code: "x".repeat(17 * 1024 * 1024) }))).toBe("limit");
  });

  it.each([0, -1, 1.5, "60000", null, 1e12, Number.MAX_SAFE_INTEGER])("12.4a refuses the timeout %p", (timeoutMs) => {
    expect(rejection(run({ timeoutMs }))).toBeDefined();
  });

  it.each(["/etc/passwd", "../outside", "..", "~/notes", "C:\\Users\\me", "\\\\server\\share", "a/../b", "/"])("12.4a refuses the raw path %p as cwd", (cwd) => {
    expect(rejection(run({ cwd }))).toBeDefined();
  });

  it("12.4a refuses an empty cwd", () => {
    expect(rejection(run({ cwd: "" }))).toBeDefined();
  });

  it("12.4a refuses a runCell sent in the page direction", () => {
    expect(rejection(run(), "toPage")).toBe("unknown-type");
  });
});

describe("12.4a cancelCell guard", () => {
  it("12.4a accepts a valid cancelCell", () => {
    const message = cancel() as unknown as ToHelperMessage;
    expect(parseHelperMessage(roundTrip(message), "toHelper")).toEqual({ ok: true, message });
  });

  it("12.4a refuses a cancelCell without requestId", () => {
    const raw: Record<string, unknown> = cancel();
    delete raw.requestId;
    expect(rejection(raw)).toBeDefined();
  });

  it("12.4a refuses an empty or non-string requestId", () => {
    expect(rejection(cancel({ requestId: "" }))).toBeDefined();
    expect(rejection(cancel({ requestId: 7 }))).toBeDefined();
  });

  it("12.4a drops keys a cancelCell does not define", () => {
    expect(parseHelperMessage({ ...cancel(), extra: 1 }, "toHelper")).toEqual({ ok: true, message: cancel() });
  });
});

describe("12.4a cellResult guard", () => {
  const results: ToPageMessage[] = [
    { ...env("run-1"), type: "cellResult", status: "ok", latex: "x^{2}", text: "x**2", durationMs: 12 },
    { ...env("run-1"), type: "cellResult", status: "error", error: "NameError: name 'y' is not defined", durationMs: 3 },
    { ...env("run-1"), type: "cellResult", status: "timeout", durationMs: 60_000 },
    { ...env("run-1"), type: "cellResult", status: "cancelled", durationMs: 5 },
    { ...env("run-1"), type: "cellResult", status: "missing", durationMs: 0 },
  ];

  it.each(results.map((m) => [(m as { status: string }).status, m] as const))("12.4a reads a cellResult with status %s", (_status, message) => {
    expect(parseHelperMessage(roundTrip(message), "toPage")).toEqual({ ok: true, message });
  });

  it("12.4a refuses a cellResult with an unknown status", () => {
    expect(rejection({ ...env("run-1"), type: "cellResult", status: "weird", durationMs: 1 }, "toPage")).toBeDefined();
  });

  it("12.4a refuses a cellResult without durationMs", () => {
    expect(rejection({ ...env("run-1"), type: "cellResult", status: "ok" }, "toPage")).toBeDefined();
  });

  it("12.4a refuses a cellResult sent in the helper direction", () => {
    expect(rejection(results[0], "toHelper")).toBe("unknown-type");
  });
});

describe("12.4d protocol version", () => {
  it("12.4d is bumped by one over the value session 11 left (6), so it is 7", () => {
    expect(PROTOCOL_VERSION).toBe(7);
  });

  it.each([1, 5, 6, 8])("12.4d refuses a runCell with version %p and reports it", (v) => {
    expect(parseHelperMessage(run({ v }), "toHelper")).toMatchObject({ ok: false, code: "version", id: "run-1", received: v });
  });

  it("12.4d refuses a cancelCell with a string version", () => {
    expect(rejection(cancel({ v: String(PROTOCOL_VERSION) }))).toBe("version");
  });

  it("12.4d refuses a cellResult with the previous version", () => {
    expect(rejection({ v: PROTOCOL_VERSION - 1, id: "run-1", type: "cellResult", status: "ok", durationMs: 1 }, "toPage")).toBe("version");
  });
});
