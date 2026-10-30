/** Verifies that the helper protocol validates runCell params, carries cellResult controls, and is at version 9. */
import { PROTOCOL_VERSION, parseHelperMessage } from "../../src/helper/index";

const runCell = (patch: Record<string, unknown> = {}) => ({
  v: PROTOCOL_VERSION, id: "1", type: "runCell", code: "beta * 2\n", cwd: "notes", timeoutMs: 20000, language: "python", noteKey: "note-1", ...patch,
});
const cellResult = (patch: Record<string, unknown> = {}) => ({
  v: PROTOCOL_VERSION, id: "1", type: "cellResult", status: "ok", language: "python", text: "1.86", durationMs: 4, ...patch,
});
const accepted = (params: unknown) => parseHelperMessage(runCell({ params }), "toHelper").ok;
const entries = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, i]));

const CONTROLS = [
  { name: "beta", kind: "slider", min: 0, max: 1, step: 0.01, value: 0.93 },
  { name: "mode", kind: "select", choices: ["fast", "slow", 3], value: "fast" },
  { name: "on", kind: "checkbox", value: true },
];

describe("3.1 Helper protocol +1: runCell carries params (validated), cellResult carries controls", () => {
  it("3.1a runCell with valid params parses and keeps them", () => {
    const params = { beta: 0.93, mode: "fast", on: true, Count_2: -4 };
    expect(parseHelperMessage(runCell({ params }), "toHelper")).toEqual({ ok: true, message: runCell({ params }) });
  });

  it("3.1a runCell without params still parses", () => {
    const result = parseHelperMessage(runCell(), "toHelper");
    expect(result.ok).toBe(true);
    if (result.ok) { expect((result.message as { params?: unknown }).params).toBeUndefined(); }
  });

  it("3.1a an empty params object parses", () => {
    expect(accepted({})).toBe(true);
  });

  it("3.1a a name that breaks the D1 rule rejects the message", () => {
    for (const name of ["1a", "_x", "a-b", "a b", "", "a.b", "é"]) { expect(accepted({ [name]: 1 })).toBe(false); }
  });

  it("3.1a eight entries parse and a ninth rejects the message", () => {
    expect(accepted(entries(8))).toBe(true);
    expect(accepted(entries(9))).toBe(false);
  });

  it("3.1a a NaN or infinite number rejects the message", () => {
    expect(accepted({ a: Number.NaN })).toBe(false);
    expect(accepted({ a: Number.POSITIVE_INFINITY })).toBe(false);
    expect(accepted({ a: Number.NEGATIVE_INFINITY })).toBe(false);
  });

  it("3.1a a value that is not a number, boolean or string rejects the message", () => {
    for (const value of [null, undefined, {}, [], [1], { x: 1 }]) { expect(accepted({ a: value })).toBe(false); }
  });

  it("3.1a a string of 200 characters parses and one of 201 rejects the message", () => {
    expect(accepted({ a: "x".repeat(200) })).toBe(true);
    expect(accepted({ a: "x".repeat(201) })).toBe(false);
  });

  it("3.1a params that are not an object reject the message", () => {
    for (const params of [null, [], [1], "beta", 3, true]) { expect(accepted(params)).toBe(false); }
  });

  it("3.1b controls survive cellResult parsing", () => {
    expect(parseHelperMessage(cellResult({ controls: CONTROLS }), "toPage")).toEqual({ ok: true, message: cellResult({ controls: CONTROLS }) });
  });

  it("3.1b a cellResult without controls still parses", () => {
    const result = parseHelperMessage(cellResult(), "toPage");
    expect(result.ok).toBe(true);
    if (result.ok) { expect((result.message as { controls?: unknown }).controls).toBeUndefined(); }
  });

  it("3.1b survives a JSON round trip", () => {
    const message = cellResult({ controls: CONTROLS });
    expect(parseHelperMessage(JSON.parse(JSON.stringify(message)), "toPage")).toEqual({ ok: true, message });
  });

  it("3.1b the protocol version is 9", () => {
    expect(PROTOCOL_VERSION).toBe(9);
  });

  it("3.1b a frame at version 8 is rejected as a version mismatch", () => {
    expect(parseHelperMessage(runCell({ v: 8 }), "toHelper")).toMatchObject({ ok: false, code: "version", received: 8 });
  });
});
