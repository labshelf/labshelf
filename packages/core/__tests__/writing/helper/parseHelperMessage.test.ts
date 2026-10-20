/** Verifies that every helper protocol message survives a JSON round trip and that malformed, unknown, oversized or wrong-version frames are rejected. */
import { PROTOCOL_VERSION, parseHelperMessage, type ToHelperMessage, type ToPageMessage } from "../../../src/writing/helper/index";

const sha = "a".repeat(64);
const env = (id: string) => ({ v: PROTOCOL_VERSION, id });

const toHelper: ToHelperMessage[] = [
  { ...env("1"), type: "hello", extensionVersion: "0.9.0", origin: "chrome-extension://abcdefghijklmnop" },
  { ...env("2"), type: "auth", token: "tok" },
  { ...env("3"), type: "openProject", projectId: "thesis", root: "writing/thesis" },
  { ...env("4"), type: "closeProject", projectId: "thesis" },
  { ...env("5"), type: "edit", projectId: "thesis", path: "main.tex", version: 1, text: "hello" },
  { ...env("6"), type: "edit", projectId: "thesis", path: "main.tex", version: 2, changes: [{ from: 0, to: 1, insert: "H" }] },
  { ...env("7"), type: "save", projectId: "thesis", path: "main.tex" },
  { ...env("8"), type: "compile", projectId: "thesis", main: "main.tex", mode: "preview" },
  { ...env("9"), type: "compile", projectId: "thesis", main: "main.tex", mode: "full", engine: "xelatex", editedFile: "chapters/a.tex", editedLine: 12 },
  { ...env("10"), type: "compile", projectId: "thesis", main: "main.tex", mode: "full", haltOnError: true },
  { ...env("11"), type: "cancel", projectId: "thesis" },
  { ...env("12"), type: "installTex", kind: "tinytex" },
  { ...env("13"), type: "installAllPackages" },
];

const toPage: ToPageMessage[] = [
  { ...env("1"), type: "ready", protocol: PROTOCOL_VERSION, helperVersion: "1.0.0", host: "helper", tex: { source: "texlive", year: 2026, complete: true } },
  { ...env("2"), type: "authed" },
  { ...env("3"), type: "opened", projectId: "thesis", files: ["main.tex"] },
  { ...env("4"), type: "closed", projectId: "thesis" },
  { ...env("8"), type: "progress", phase: "building", message: "Running pdflatex", fraction: 0.5 },
  { ...env("8"), type: "built", status: "succeeded", problems: [], pdfSha256: sha },
  { ...env("8"), type: "pages", pdfSha256: sha, pageCount: 2, changed: [{ index: 0, offset: 0, length: 10 }] },
  { ...env("8"), type: "error", code: "stale", message: "version 3 does not follow 1" },
];

const roundTrip = (message: object): unknown => JSON.parse(JSON.stringify(message));
const reject = (raw: unknown, direction: "toHelper" | "toPage" = "toHelper") => {
  const result = parseHelperMessage(raw, direction);
  return result.ok ? undefined : result.code;
};

describe("parseHelperMessage round trip", () => {
  it("is protocol version 5", () => { expect(PROTOCOL_VERSION).toBe(5); });

  it.each(toHelper.map((m) => [m.type, m]))("reads %s sent to the helper", (_type, message) => {
    expect(parseHelperMessage(roundTrip(message), "toHelper")).toEqual({ ok: true, message });
  });

  it.each(toPage.map((m) => [m.type, m]))("reads %s sent to the page", (_type, message) => {
    expect(parseHelperMessage(roundTrip(message), "toPage")).toEqual({ ok: true, message });
  });

  it("drops keys a message does not define", () => {
    const result = parseHelperMessage({ ...toHelper[3]!, extra: 1 }, "toHelper");
    expect(result).toEqual({ ok: true, message: toHelper[3] });
  });
});

describe("parseHelperMessage rejections", () => {
  it("rejects a non-object, a missing id and a missing type", () => {
    expect(reject("hello")).toBe("malformed");
    expect(reject(null)).toBe("malformed");
    expect(reject({ v: PROTOCOL_VERSION, type: "closeProject", projectId: "a" })).toBe("malformed");
    expect(reject({ ...env("1") })).toBe("malformed");
  });

  it("rejects v1 and reports the received version", () => {
    const result = parseHelperMessage({ ...toHelper[3]!, v: 1 }, "toHelper");
    expect(result).toMatchObject({ ok: false, code: "version", id: "4", received: 1 });
    expect(reject({ ...toHelper[3]!, v: String(PROTOCOL_VERSION) })).toBe("version");
    expect(reject({ ...toHelper[3]!, v: 2 })).toBe("version");
  });

  it("rejects a compile whose haltOnError is not a boolean", () => {
    expect(reject({ ...env("1"), type: "compile", projectId: "thesis", main: "main.tex", mode: "full", haltOnError: "yes" })).toBe("invalid-field");
  });

  it.each(["sync", "file", "delete", "build"])("rejects the removed type %s as unknown-type", (type) => {
    expect(reject({ ...env("1"), type, projectId: "thesis", main: "main.tex", engine: "pdflatex", files: [], paths: [], path: "a.tex" })).toBe("unknown-type");
  });

  it("rejects the removed lsp type in both directions as unknown-type", () => {
    const lsp = { ...env("1"), type: "lsp", projectId: "thesis", payload: { jsonrpc: "2.0", method: "initialize" } };
    expect(reject(lsp)).toBe("unknown-type");
    expect(reject(lsp, "toPage")).toBe("unknown-type");
  });

  it("rejects a page-bound message without an id except error", () => {
    expect(reject({ v: PROTOCOL_VERSION, type: "authed" }, "toPage")).toBe("malformed");
    expect(parseHelperMessage({ v: PROTOCOL_VERSION, type: "error", code: "stale", message: "m" }, "toPage").ok).toBe(true);
  });

  it("rejects types of the other direction", () => {
    expect(reject({ ...env("1"), type: "authed" })).toBe("unknown-type");
    expect(reject({ ...toHelper[0]! }, "toPage")).toBe("unknown-type");
  });

  it("requires an origin in hello", () => {
    const { origin: _origin, ...bare } = toHelper[0] as Extract<ToHelperMessage, { type: "hello" }>;
    expect(reject(bare)).toBe("invalid-field");
  });

  it("rejects an unsafe path, main or editedFile", () => {
    expect(reject({ ...toHelper[4]!, path: "../x" })).toBe("path");
    expect(reject({ ...toHelper[6]!, path: "/etc/passwd" })).toBe("path");
    expect(reject({ ...toHelper[7]!, main: "a\\main.tex" })).toBe("path");
    expect(reject({ ...toHelper[8]!, editedFile: "C:/x.tex" })).toBe("path");
  });

  it("rejects a project id outside the library id rule", () => {
    expect(reject({ ...toHelper[3]!, projectId: "../thesis" })).toBe("project-id");
  });

  it("rejects bad edit fields", () => {
    expect(reject({ ...toHelper[4]!, version: 0 })).toBe("invalid-field");
    expect(reject({ ...toHelper[4]!, version: 1.5 })).toBe("invalid-field");
    const { text: _text, ...neither } = toHelper[4] as Extract<ToHelperMessage, { type: "edit" }>;
    expect(reject(neither)).toBe("invalid-field");
    expect(reject({ ...toHelper[5]!, changes: [{ from: 0, to: 1 }] })).toBe("invalid-field");
  });

  it("rejects bad compile and install fields", () => {
    expect(reject({ ...toHelper[7]!, mode: "draft" })).toBe("invalid-field");
    expect(reject({ ...toHelper[8]!, engine: "context" })).toBe("invalid-field");
    expect(reject({ ...toHelper[11]!, kind: "miktex" })).toBe("invalid-field");
    for (const editedLine of [0, -1, 1.5, "3"]) { expect(reject({ ...toHelper[8]!, editedLine })).toBe("invalid-field"); }
  });

  it("rejects bad page-bound fields", () => {
    expect(reject({ ...toPage[4]!, fraction: 2 }, "toPage")).toBe("invalid-field");
    expect(reject({ ...toPage[0]!, host: "zed" }, "toPage")).toBe("invalid-field");
    expect(reject({ ...toPage[6]!, changed: [{ index: -1, offset: 0, length: 1 }] }, "toPage")).toBe("invalid-field");
  });
});

describe("parseHelperMessage limits", () => {
  const edit = (count: number) => ({
    ...env("1"), type: "edit", projectId: "thesis", path: "main.tex", version: 2,
    changes: Array.from({ length: count }, () => ({ from: 0, to: 0, insert: "x" })),
  });

  it("accepts 10000 changes and rejects 10001 with limit", () => {
    expect(parseHelperMessage(edit(10000), "toHelper").ok).toBe(true);
    expect(parseHelperMessage(edit(10001), "toHelper")).toMatchObject({ ok: false, code: "limit", id: "1" });
  });
});
