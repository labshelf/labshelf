import { isShareMessage, parseShareCall, parseShareReply } from "../../../src/libraryUi/share";

const call = (op: string, args: unknown, over: Record<string, unknown> = {}) => ({ channel: "sharing", type: "call", id: 1, op, args, ...over });

describe("parseSharingCall", () => {
  it("accepts a call with the op's arguments, a cancel and a hello", () => {
    expect(parseShareCall(call("projects", []))).toEqual(call("projects", []));
    expect(parseShareCall(call("shareFolder", ["papers/ml", true]))).not.toBeNull();
    expect(parseShareCall(call("openLink", ["https://example.org/x"]))).not.toBeNull();
    expect(parseShareCall({ channel: "sharing", type: "cancel", id: 3 })).not.toBeNull();
    expect(parseShareCall({ channel: "sharing", type: "hello" })).not.toBeNull();
  });

  it("rejects another channel, an unknown op and a bad id", () => {
    expect(parseShareCall(call("projects", [], { channel: "library" }))).toBeNull();
    expect(parseShareCall(call("toString", []))).toBeNull();
    expect(parseShareCall(call("projects", [], { id: -1 }))).toBeNull();
    expect(parseShareCall(call("projects", [], { id: 1.5 }))).toBeNull();
    expect(parseShareCall({ channel: "sharing", type: "cancel", id: "1" })).toBeNull();
    expect(parseShareCall(null)).toBeNull();
  });

  it("rejects the wrong arity and argument types", () => {
    expect(parseShareCall(call("projects", ["x"]))).toBeNull();
    expect(parseShareCall(call("projectStatus", []))).toBeNull();
    expect(parseShareCall(call("projectStatus", [""]))).toBeNull();
    expect(parseShareCall(call("projectStatus", ["a".repeat(4097)]))).toBeNull();
    expect(parseShareCall(call("shareFolder", ["papers/ml", "yes"]))).toBeNull();
    expect(parseShareCall(call("joinProject", [42]))).toBeNull();
    expect(parseShareCall(call("importLink", ["a".repeat(16385)]))).toBeNull();
    expect(parseShareCall(call("projects", "nope"))).toBeNull();
  });

  it("rejects folder paths outside papers and links that are not web addresses", () => {
    expect(parseShareCall(call("shareFolder", ["../etc", false]))).toBeNull();
    expect(parseShareCall(call("openFolder", ["papers/../x"]))).toBeNull();
    expect(parseShareCall(call("shareableFolder", ["notes"]))).toBeNull();
    expect(parseShareCall(call("openLink", ["javascript:alert(1)"]))).toBeNull();
    expect(parseShareCall(call("openLink", ["file:///etc/passwd"]))).toBeNull();
  });

  it("tells sharing messages apart from others", () => {
    expect(isShareMessage({ channel: "sharing", type: "bogus" })).toBe(true);
    expect(isShareMessage({ type: "ready" })).toBe(false);
    expect(isShareMessage("sharing")).toBe(false);
  });
});

describe("parseSharingReply", () => {
  const reply = (body: Record<string, unknown>) => ({ channel: "sharing", ...body });

  it("accepts results, progress, offers and dialog requests", () => {
    expect(parseShareReply(reply({ type: "result", id: 1, ok: true, value: [1] }))).not.toBeNull();
    expect(parseShareReply(reply({ type: "result", id: 1, ok: false, error: "no" }))).not.toBeNull();
    expect(parseShareReply(reply({ type: "progress", id: 1, progress: { stage: "uploading" } }))).not.toBeNull();
    expect(parseShareReply(reply({ type: "progress", id: 1, progress: { done: 1, total: 2 } }))).not.toBeNull();
    expect(parseShareReply(reply({ type: "offers", offers: { projects: true, links: false }, place: "this device" }))).not.toBeNull();
    expect(parseShareReply(reply({ type: "open", request: { kind: "shareFolder", path: "papers/ml" } }))).not.toBeNull();
    expect(parseShareReply(reply({ type: "open", request: { kind: "manageLinks" } }))).not.toBeNull();
  });

  it("rejects malformed replies", () => {
    expect(parseShareReply({ type: "result", id: 1, ok: true, value: 1 })).toBeNull();
    expect(parseShareReply(reply({ type: "result", id: 1, ok: false }))).toBeNull();
    expect(parseShareReply(reply({ type: "progress", id: 1, progress: { stage: "flying" } }))).toBeNull();
    expect(parseShareReply(reply({ type: "offers", offers: { projects: "yes", links: false }, place: "x" }))).toBeNull();
    expect(parseShareReply(reply({ type: "offers", offers: { projects: true, links: false } }))).toBeNull();
    expect(parseShareReply(reply({ type: "open", request: { kind: "explode" } }))).toBeNull();
    expect(parseShareReply(reply({ type: "open", request: { kind: "joinProject", invite: 7 } }))).toBeNull();
  });
});
