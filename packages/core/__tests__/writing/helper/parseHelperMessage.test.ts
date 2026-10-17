/** Verifies that every helper protocol message survives a JSON round trip and that malformed, unknown, oversized or wrong-version frames are rejected. */
import {
  MAX_SYNC_FILES, MAX_SYNC_TOTAL_BYTES, PROTOCOL_VERSION, parseHelperMessage,
  type ToHelperMessage, type ToPageMessage,
} from "../../../src/writing/helper/index";

const sha = "a".repeat(64);
const chunk = { index: 0, count: 1, data: btoa("hello") };
const env = (id: string) => ({ v: PROTOCOL_VERSION, id });

const toHelper: ToHelperMessage[] = [
  { ...env("1"), type: "hello", extensionVersion: "0.9.0" },
  { ...env("2"), type: "sync", projectId: "thesis", files: [{ path: "main.tex", sha256: sha, size: 12 }] },
  { ...env("3"), type: "file", projectId: "thesis", path: "chapters/intro.tex", chunk },
  { ...env("4"), type: "delete", projectId: "thesis", paths: ["old.tex"] },
  { ...env("5"), type: "build", projectId: "thesis", main: "main.tex", engine: "lualatex" },
  { ...env("6"), type: "cancel", projectId: "thesis" },
  { ...env("7"), type: "installTex", kind: "tinytex" },
  { ...env("8"), type: "installAllPackages" },
];

const toPage: ToPageMessage[] = [
  { ...env("1"), type: "ready", protocol: 1, helperVersion: "1.0.0", tex: { source: "texlive", year: 2026, complete: true } },
  { ...env("1"), type: "ready", protocol: 1, helperVersion: "1.0.0", tex: { source: "none", complete: false } },
  { ...env("2"), type: "need", paths: ["main.tex"] },
  { ...env("5"), type: "progress", phase: "building", message: "Running pdflatex", fraction: 0.5 },
  { ...env("5"), type: "progress", phase: "installing-package", message: "Installing tikz" },
  {
    ...env("5"), type: "built", status: "failed",
    problems: [{ severity: "error", message: "Undefined control sequence", file: "main.tex", line: 3, hint: "Check it." }],
  },
  { ...env("5"), type: "built", status: "succeeded", problems: [], pdfSha256: sha },
  { ...env("5"), type: "pdf", chunk },
  { ...env("5"), type: "error", code: "invalid-message", message: "path has a .. segment" },
];

function roundTrip(message: object): unknown {
  return JSON.parse(JSON.stringify(message));
}

describe("parseHelperMessage round trip", () => {
  it.each(toHelper.map((m) => [m.type, m]))("reads %s sent to the helper", (_type, message) => {
    expect(parseHelperMessage(roundTrip(message), "toHelper")).toEqual({ ok: true, message });
  });

  it.each(toPage.map((m) => [m.type, m]))("reads %s sent to the page", (_type, message) => {
    expect(parseHelperMessage(roundTrip(message), "toPage")).toEqual({ ok: true, message });
  });
});

describe("parseHelperMessage rejections", () => {
  const reject = (raw: unknown, direction: "toHelper" | "toPage" = "toHelper") => {
    const result = parseHelperMessage(raw, direction);
    return result.ok ? undefined : result.code;
  };

  it("rejects a non-object, a missing id and a missing type", () => {
    expect(reject("hello")).toBe("malformed");
    expect(reject(null)).toBe("malformed");
    expect(reject({ v: PROTOCOL_VERSION, type: "hello", extensionVersion: "1" })).toBe("malformed");
  });

  it("rejects a v different from the protocol version and reports the received version", () => {
    const result = parseHelperMessage({ v: PROTOCOL_VERSION + 1, id: "1", type: "hello", extensionVersion: "1" }, "toHelper");
    expect(result).toMatchObject({ ok: false, code: "version", id: "1", received: PROTOCOL_VERSION + 1 });
    expect(reject({ v: "1", id: "1", type: "hello", extensionVersion: "1" })).toBe("version");
  });

  it("rejects unknown types and types of the other direction", () => {
    expect(reject({ ...env("1"), type: "format" })).toBe("unknown-type");
    expect(reject({ ...env("1"), type: "ready", protocol: 1 })).toBe("unknown-type");
    expect(reject({ ...env("1"), type: "hello", extensionVersion: "1" }, "toPage")).toBe("unknown-type");
  });

  it("rejects an unsafe path in every message that carries one", () => {
    expect(reject({ ...toHelper[1]!, files: [{ path: "../x", sha256: sha, size: 1 }] })).toBe("path");
    expect(reject({ ...toHelper[2]!, path: "/etc/passwd" })).toBe("path");
    expect(reject({ ...toHelper[3]!, paths: ["C:/x"] })).toBe("path");
    expect(reject({ ...toHelper[4]!, main: "a\\main.tex" })).toBe("path");
    expect(reject({ ...toPage[2]!, paths: ["a/../../b"] }, "toPage")).toBe("path");
  });

  it("rejects a project id outside the library id rule", () => {
    expect(reject({ ...toHelper[5]!, projectId: "../thesis" })).toBe("project-id");
  });

  it("rejects Tectonic and unknown engines", () => {
    expect(reject({ ...toHelper[4]!, engine: "tectonic" })).toBe("invalid-field");
    expect(reject({ ...toHelper[4]!, engine: "context" })).toBe("invalid-field");
  });

  it("rejects bad field values", () => {
    expect(reject({ ...toHelper[1]!, files: [{ path: "a.tex", sha256: "xyz", size: 1 }] })).toBe("invalid-field");
    expect(reject({ ...toHelper[1]!, files: [{ path: "a.tex", sha256: sha, size: -1 }] })).toBe("invalid-field");
    expect(reject({ ...toHelper[2]!, chunk: { index: 1, count: 1, data: "" } })).toBe("invalid-field");
    expect(reject({ ...toHelper[6]!, kind: "miktex" })).toBe("invalid-field");
    expect(reject({ ...toPage[3]!, fraction: 2 }, "toPage")).toBe("invalid-field");
    expect(reject({ ...toPage[5]!, problems: [{ severity: "fatal", message: "x", file: "a.tex" }] }, "toPage")).toBe("invalid-field");
    expect(reject({ ...toPage[6]!, status: "maybe" }, "toPage")).toBe("invalid-field");
  });

  it("rejects duplicate paths in a sync", () => {
    const file = { path: "a.tex", sha256: sha, size: 1 };
    expect(reject({ ...toHelper[1]!, files: [file, file] })).toBe("invalid-field");
  });
});

describe("parseHelperMessage limits", () => {
  const files = (count: number, size: number) =>
    Array.from({ length: count }, (_, i) => ({ path: `f${i}.tex`, sha256: sha, size }));
  const sync = (list: unknown) => parseHelperMessage({ ...env("1"), type: "sync", projectId: "thesis", files: list }, "toHelper");

  it("accepts the file count and total size at the limit", () => {
    expect(sync(files(MAX_SYNC_FILES, 1)).ok).toBe(true);
    expect(sync(files(2, MAX_SYNC_TOTAL_BYTES / 2)).ok).toBe(true);
  });

  it("rejects more files or more declared bytes than the limit", () => {
    expect(sync(files(MAX_SYNC_FILES + 1, 1))).toMatchObject({ ok: false, code: "limit" });
    expect(sync(files(2, MAX_SYNC_TOTAL_BYTES / 2 + 1))).toMatchObject({ ok: false, code: "limit" });
  });

  it("rejects a delete or need list longer than the file limit", () => {
    const paths = Array.from({ length: MAX_SYNC_FILES + 1 }, (_, i) => `f${i}.tex`);
    expect(parseHelperMessage({ ...env("1"), type: "delete", projectId: "thesis", paths }, "toHelper")).toMatchObject({ code: "limit" });
    expect(parseHelperMessage({ ...env("1"), type: "need", paths }, "toPage")).toMatchObject({ code: "limit" });
  });

  it("rejects chunk data longer than 512 KiB of raw bytes", () => {
    const data = btoa("x".repeat(512 * 1024 + 1));
    const result = parseHelperMessage({ ...env("1"), type: "pdf", chunk: { index: 0, count: 1, data } }, "toPage");
    expect(result).toMatchObject({ ok: false, code: "limit" });
  });
});
