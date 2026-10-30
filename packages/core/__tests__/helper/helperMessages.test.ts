/** Verifies the installPython message, the python phase and ready.python at the parser, and that the bumped protocol version refuses the old one. */
import { PROGRESS_PHASES, PROTOCOL_VERSION, parseHelperMessage, type ToHelperMessage, type ToPageMessage } from "../../src/helper/index";

const OLD_PROTOCOL_VERSION = 7;
const env = (id: string) => ({ v: PROTOCOL_VERSION, id });
const roundTrip = (message: object): unknown => JSON.parse(JSON.stringify(message));
const reject = (raw: unknown, direction: "toHelper" | "toPage" = "toHelper") => {
  const result = parseHelperMessage(raw, direction);
  return result.ok ? undefined : result.code;
};

describe("installPython guard", () => {
  const install: ToHelperMessage = { ...env("7"), type: "installPython" };

  it("11.2a passes installPython to the helper", () => {
    expect(parseHelperMessage(roundTrip(install), "toHelper")).toEqual({ ok: true, message: install });
  });

  it("11.2a drops keys installPython does not define", () => {
    expect(parseHelperMessage({ ...install, extra: 1 }, "toHelper")).toEqual({ ok: true, message: install });
  });

  it("11.2a drops an installPython without an id as malformed", () => {
    expect(reject({ v: PROTOCOL_VERSION, type: "installPython" })).toBe("malformed");
  });

  it("11.2a drops an installPython that is not an object as malformed", () => {
    expect(reject("installPython")).toBe("malformed");
    expect(reject(null)).toBe("malformed");
  });

  it("11.2a rejects installPython sent to the page as unknown-type", () => {
    expect(reject(roundTrip(install), "toPage")).toBe("unknown-type");
  });
});

describe("python replies", () => {
  it("11.2a reads a progress with phase python", () => {
    expect(PROGRESS_PHASES).toContain("python");
    const progress: ToPageMessage = { ...env("7"), type: "progress", phase: "python", message: "Installing Python", fraction: 0.4 };
    expect(parseHelperMessage(roundTrip(progress), "toPage")).toEqual({ ok: true, message: progress });
  });

  it.each(["missing", "installed"] as const)("11.2a reads a ready whose python is %s", (python) => {
    const ready: ToPageMessage = {
      ...env("7"), type: "ready", protocol: PROTOCOL_VERSION, helperVersion: "1.0.0", host: "helper",
      tex: { source: "texlive", year: 2026, complete: true }, python,
    };
    expect(parseHelperMessage(roundTrip(ready), "toPage")).toEqual({ ok: true, message: ready });
  });

  it("11.2a keeps python absent on a ready that has none", () => {
    const ready: ToPageMessage = {
      ...env("7"), type: "ready", protocol: PROTOCOL_VERSION, helperVersion: "1.0.0", host: "helper",
      tex: { source: "texlive", year: 2026, complete: true },
    };
    const result = parseHelperMessage(roundTrip(ready), "toPage");
    expect(result).toEqual({ ok: true, message: ready });
    expect(result.ok && "python" in result.message).toBe(false);
  });

  it("11.2a rejects a ready whose python is neither missing nor installed", () => {
    const ready = {
      ...env("7"), type: "ready", protocol: PROTOCOL_VERSION, helperVersion: "1.0.0", host: "helper",
      tex: { source: "texlive", year: 2026, complete: true }, python: "broken",
    };
    expect(reject(roundTrip(ready), "toPage")).toBe("invalid-field");
  });
});

describe("protocol version", () => {
  it("11.2c is one higher than before", () => {
    expect(PROTOCOL_VERSION).toBe(OLD_PROTOCOL_VERSION + 1);
  });

  it("11.2c refuses a message with the old version and reports it", () => {
    const result = parseHelperMessage({ v: OLD_PROTOCOL_VERSION, id: "9", type: "hello", extensionVersion: "0.9.0", origin: "chrome-extension://abc" }, "toHelper");
    expect(result).toMatchObject({ ok: false, code: "version", id: "9", received: OLD_PROTOCOL_VERSION });
  });

  it("11.2c refuses an installPython with the old version", () => {
    expect(reject({ v: OLD_PROTOCOL_VERSION, id: "9", type: "installPython" })).toBe("version");
  });
});
