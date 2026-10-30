// Pins the source editor's webview protocol (D6): every message kind parses back as sent; an invalid message is rejected whole.
import {
  parseSourceEditorInbound,
  parseSourceEditorOutbound,
  type SourceEditorInbound,
  type SourceEditorOutbound,
} from "../../../src/writing/sourceEditor/protocol";

const updates = [
  { clientID: "c1", changes: [{ from: 0, to: 0, insert: "x" }] },
  { clientID: "host", changes: [{ from: 2, to: 5, insert: "" }, { from: 7, to: 7, insert: "a\nb" }] },
];

const init = {
  type: "init" as const, path: "main.tex", projectId: "p1", language: "latex" as const, text: "a\r\nb", lineBreak: "\r\n" as const,
  version: 3, readOnly: false, dirty: true,
};

const inbound: SourceEditorInbound[] = [
  init,
  { ...init, language: "typst", path: "notes.typ", lineBreak: "\n", readOnly: true, dirty: false, text: "" },
  { type: "updates", version: 4, updates },
  { type: "updates", version: 4, updates: [] },
  { type: "resync", text: "fresh", version: 9 },
  { type: "dirty", dirty: true },
  { type: "dirty", dirty: false },
  { type: "reveal", line: 12 },
  { type: "problems", problems: [] },
  { type: "problems", problems: [{ line: 3, severity: "error", message: "Undefined control sequence" }, { line: 4, severity: "warning", message: "w" }, { line: 5, severity: "info", message: "i" }] },
  { type: "command", command: { kind: "insertText", text: "x" } },
  { type: "command", command: { kind: "insertSnippet", snippet: "\\frac{${1}}{${2}}" } },
  { type: "command", command: { kind: "wrap", style: "bold" } },
  { type: "command", command: { kind: "wrap", style: "italic" } },
  { type: "response", id: 1, ok: true, value: { papers: [1, 2] } },
  { type: "response", id: 2, ok: true, value: null },
  { type: "response", id: 3, ok: false, error: "outside the project" },
  { type: "comments", ranges: [] },
  { type: "peers", peers: [] },
  { type: "peers", peers: [{ name: "Ada", colour: "#ff0000", anchor: 1, head: 4 }] },
];

const outbound: SourceEditorOutbound[] = [
  { type: "ready" },
  { type: "push", version: 3, updates },
  { type: "push", version: 0, updates: [] },
  { type: "save" },
  { type: "selection", anchor: 4, head: 9, line: 2 },
  { type: "focus", focused: true },
  { type: "focus", focused: false },
];

describe("source editor protocol: round trip", () => {
  it.each(inbound.map((message, index) => [`${message.type} #${index}`, message] as const))("2.2a parses the inbound %s as sent", (_name, message) => {
    expect(parseSourceEditorInbound(message)).toEqual(message);
  });

  it.each(outbound.map((message, index) => [`${message.type} #${index}`, message] as const))("2.2a parses the outbound %s as sent", (_name, message) => {
    expect(parseSourceEditorOutbound(message)).toEqual(message);
  });

  it("2.2a parses a message that went through JSON, as one that crossed postMessage does", () => {
    for (const message of inbound) expect(parseSourceEditorInbound(JSON.parse(JSON.stringify(message)))).toEqual(message);
    for (const message of outbound) expect(parseSourceEditorOutbound(JSON.parse(JSON.stringify(message)))).toEqual(message);
  });
});

describe("source editor protocol: rejection", () => {
  it.each([null, undefined, 5, "init", true, [], [init]])("2.2b rejects a value that is not a message object (%p)", (value) => {
    expect(parseSourceEditorInbound(value)).toBeUndefined();
    expect(parseSourceEditorOutbound(value)).toBeUndefined();
  });

  it("2.2b rejects an unknown type and a missing type", () => {
    expect(parseSourceEditorInbound({ type: "explode" })).toBeUndefined();
    expect(parseSourceEditorInbound({ dirty: true })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: 3, dirty: true })).toBeUndefined();
    expect(parseSourceEditorOutbound({ type: "explode" })).toBeUndefined();
    expect(parseSourceEditorOutbound({})).toBeUndefined();
  });

  it("2.2b rejects a message of the other direction", () => {
    expect(parseSourceEditorInbound({ type: "ready" })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "save" })).toBeUndefined();
    expect(parseSourceEditorOutbound({ type: "dirty", dirty: true })).toBeUndefined();
    expect(parseSourceEditorOutbound({ type: "resync", text: "x", version: 1 })).toBeUndefined();
  });

  it.each(["path", "projectId", "language", "text", "lineBreak", "version", "readOnly", "dirty"])("2.2b rejects an init without %s", (field) => {
    const rest: Record<string, unknown> = { ...init };
    delete rest[field];
    expect(parseSourceEditorInbound(rest)).toBeUndefined();
  });

  it.each([
    ["a language that is not latex or typst", { language: "markdown" }],
    ["a line break that is not LF or CRLF", { lineBreak: "\r" }],
    ["a version that is a string", { version: "3" }],
    ["a text that is a number", { text: 7 }],
    ["a readOnly that is a string", { readOnly: "no" }],
    ["a dirty that is a number", { dirty: 1 }],
    ["a path that is not a string", { path: null }],
  ])("2.2b rejects an init with %s", (_name, patch) => {
    expect(parseSourceEditorInbound({ ...init, ...patch })).toBeUndefined();
  });

  it("2.2b rejects updates with one bad change whole, not just the bad part", () => {
    const bad = { type: "updates", version: 1, updates: [updates[0], { clientID: "c2", changes: [{ from: 0, to: 0, insert: 5 }] }] };
    expect(parseSourceEditorInbound(bad)).toBeUndefined();
    expect(parseSourceEditorOutbound({ ...bad, type: "push" })).toBeUndefined();
  });

  it.each([
    ["a missing clientID", { changes: [{ from: 0, to: 0, insert: "" }] }],
    ["a clientID that is a number", { clientID: 4, changes: [] }],
    ["changes that are not an array", { clientID: "c", changes: { from: 0, to: 0, insert: "" } }],
    ["a change without insert", { clientID: "c", changes: [{ from: 0, to: 0 }] }],
    ["a change with a from that is a string", { clientID: "c", changes: [{ from: "0", to: 0, insert: "" }] }],
    ["a change with a to that is missing", { clientID: "c", changes: [{ from: 0, insert: "" }] }],
    ["an update that is null", null],
  ])("2.2b rejects updates with %s", (_name, update) => {
    expect(parseSourceEditorInbound({ type: "updates", version: 1, updates: [update] })).toBeUndefined();
    expect(parseSourceEditorOutbound({ type: "push", version: 1, updates: [update] })).toBeUndefined();
  });

  it("2.2b rejects updates and push with a missing or wrong version or updates", () => {
    expect(parseSourceEditorInbound({ type: "updates", updates })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "updates", version: "1", updates })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "updates", version: 1 })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "updates", version: 1, updates: "none" })).toBeUndefined();
    expect(parseSourceEditorOutbound({ type: "push", updates })).toBeUndefined();
    expect(parseSourceEditorOutbound({ type: "push", version: 1 })).toBeUndefined();
  });

  it("2.2b rejects resync, dirty and reveal with a wrong or missing field", () => {
    expect(parseSourceEditorInbound({ type: "resync", text: "x" })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "resync", version: 1 })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "resync", text: 5, version: 1 })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "dirty" })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "dirty", dirty: "yes" })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "reveal" })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "reveal", line: "3" })).toBeUndefined();
  });

  it("2.2b rejects problems with one bad entry whole", () => {
    const good = { line: 1, severity: "error", message: "m" };
    expect(parseSourceEditorInbound({ type: "problems", problems: [good, { ...good, severity: "fatal" }] })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "problems", problems: [good, { ...good, line: "1" }] })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "problems", problems: [good, { line: 1, severity: "error" }] })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "problems", problems: [good, null] })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "problems" })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "problems", problems: good })).toBeUndefined();
  });

  it("2.2b rejects an unknown or malformed command", () => {
    expect(parseSourceEditorInbound({ type: "command" })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "command", command: { kind: "format" } })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "command", command: { kind: "insertText" } })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "command", command: { kind: "insertText", text: 4 } })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "command", command: { kind: "insertSnippet", text: "x" } })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "command", command: { kind: "wrap", style: "underline" } })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "command", command: { kind: "wrap" } })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "command", command: "wrap" })).toBeUndefined();
  });

  it("2.2b rejects a response with a wrong or missing field", () => {
    expect(parseSourceEditorInbound({ type: "response", ok: true, value: 1 })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "response", id: "1", ok: true, value: 1 })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "response", id: 1, value: 1 })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "response", id: 1, ok: "true", value: 1 })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "response", id: 1, ok: false })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "response", id: 1, ok: false, error: 5 })).toBeUndefined();
  });

  it("2.2b rejects comments whose ranges are not an array and peers with a bad entry", () => {
    expect(parseSourceEditorInbound({ type: "comments" })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "comments", ranges: {} })).toBeUndefined();
    const peer = { name: "Ada", colour: "#fff", anchor: 1, head: 2 };
    expect(parseSourceEditorInbound({ type: "peers" })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "peers", peers: [peer, { ...peer, anchor: "1" }] })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "peers", peers: [peer, { name: "Bo", colour: "#000", anchor: 1 }] })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "peers", peers: [peer, { ...peer, name: 3 }] })).toBeUndefined();
  });

  it("2.2b rejects selection and focus with a wrong or missing field", () => {
    expect(parseSourceEditorOutbound({ type: "selection", anchor: 1, head: 2 })).toBeUndefined();
    expect(parseSourceEditorOutbound({ type: "selection", anchor: 1, head: "2", line: 1 })).toBeUndefined();
    expect(parseSourceEditorOutbound({ type: "selection", anchor: null, head: 2, line: 1 })).toBeUndefined();
    expect(parseSourceEditorOutbound({ type: "focus" })).toBeUndefined();
    expect(parseSourceEditorOutbound({ type: "focus", focused: 1 })).toBeUndefined();
  });

  it("2.2b rejects a request with an unknown method", () => {
    expect(parseSourceEditorOutbound({ type: "request", id: 1, method: "deleteEverything", params: {} })).toBeUndefined();
    expect(parseSourceEditorOutbound({ type: "request", id: 1, method: "papers ", params: {} })).toBeUndefined();
    expect(parseSourceEditorOutbound({ type: "request", id: 1, method: "", params: {} })).toBeUndefined();
  });

  it("2.2b rejects a request with a wrong id or method type", () => {
    expect(parseSourceEditorOutbound({ type: "request", method: "papers", params: {} })).toBeUndefined();
    expect(parseSourceEditorOutbound({ type: "request", id: "1", method: "papers", params: {} })).toBeUndefined();
    expect(parseSourceEditorOutbound({ type: "request", id: 1, params: {} })).toBeUndefined();
    expect(parseSourceEditorOutbound({ type: "request", id: 1, method: 7, params: {} })).toBeUndefined();
  });

  it("2.2b does not mutate the message it rejects", () => {
    const message = { type: "updates", version: 1, updates: [{ clientID: "c", changes: [{ from: 0, to: 0, insert: 1 }] }] };
    const copy = JSON.parse(JSON.stringify(message));
    expect(parseSourceEditorInbound(message)).toBeUndefined();
    expect(message).toEqual(copy);
  });
});
