import { isSharingMessage, parseSharingCall, parseSharingReply } from "../../../src/libraryUi/share";

const call = (op: string, args: unknown, over: Record<string, unknown> = {}) => ({ channel: "sharing", type: "call", id: 1, op, args, ...over });

describe("parseSharingCall", () => {
  it("accepts a call with the op's arguments, a cancel and a hello", () => {
    expect(parseSharingCall(call("projects", []))).toEqual(call("projects", []));
    expect(parseSharingCall(call("shareFolder", ["papers/ml", true]))).not.toBeNull();
    expect(parseSharingCall(call("openLink", ["https://example.org/x"]))).not.toBeNull();
    expect(parseSharingCall({ channel: "sharing", type: "cancel", id: 3 })).not.toBeNull();
    expect(parseSharingCall({ channel: "sharing", type: "hello" })).not.toBeNull();
  });

  it("rejects another channel, an unknown op and a bad id", () => {
    expect(parseSharingCall(call("projects", [], { channel: "library" }))).toBeNull();
    expect(parseSharingCall(call("toString", []))).toBeNull();
    expect(parseSharingCall(call("projects", [], { id: -1 }))).toBeNull();
    expect(parseSharingCall(call("projects", [], { id: 1.5 }))).toBeNull();
    expect(parseSharingCall({ channel: "sharing", type: "cancel", id: "1" })).toBeNull();
    expect(parseSharingCall(null)).toBeNull();
  });

  it("rejects the wrong arity and argument types", () => {
    expect(parseSharingCall(call("projects", ["x"]))).toBeNull();
    expect(parseSharingCall(call("projectStatus", []))).toBeNull();
    expect(parseSharingCall(call("projectStatus", [""]))).toBeNull();
    expect(parseSharingCall(call("projectStatus", ["a".repeat(4097)]))).toBeNull();
    expect(parseSharingCall(call("shareFolder", ["papers/ml", "yes"]))).toBeNull();
    expect(parseSharingCall(call("joinProject", [42]))).toBeNull();
    expect(parseSharingCall(call("importLink", ["a".repeat(16385)]))).toBeNull();
    expect(parseSharingCall(call("projects", "nope"))).toBeNull();
  });

  it("rejects folder paths outside papers and links that are not web addresses", () => {
    expect(parseSharingCall(call("shareFolder", ["../etc", false]))).toBeNull();
    expect(parseSharingCall(call("openFolder", ["papers/../x"]))).toBeNull();
    expect(parseSharingCall(call("shareableFolder", ["notes"]))).toBeNull();
    expect(parseSharingCall(call("openLink", ["javascript:alert(1)"]))).toBeNull();
    expect(parseSharingCall(call("openLink", ["file:///etc/passwd"]))).toBeNull();
  });

  it("tells sharing messages apart from others", () => {
    expect(isSharingMessage({ channel: "sharing", type: "bogus" })).toBe(true);
    expect(isSharingMessage({ type: "ready" })).toBe(false);
    expect(isSharingMessage("sharing")).toBe(false);
  });
});

describe("parseSharingReply", () => {
  const reply = (body: Record<string, unknown>) => ({ channel: "sharing", ...body });

  it("accepts results, progress, offers and dialog requests", () => {
    expect(parseSharingReply(reply({ type: "result", id: 1, ok: true, value: [1] }))).not.toBeNull();
    expect(parseSharingReply(reply({ type: "result", id: 1, ok: false, error: "no" }))).not.toBeNull();
    expect(parseSharingReply(reply({ type: "progress", id: 1, progress: { stage: "uploading" } }))).not.toBeNull();
    expect(parseSharingReply(reply({ type: "progress", id: 1, progress: { done: 1, total: 2 } }))).not.toBeNull();
    expect(parseSharingReply(reply({ type: "offers", offers: { projects: true, links: false }, place: "this device" }))).not.toBeNull();
    expect(parseSharingReply(reply({ type: "open", request: { kind: "shareFolder", path: "papers/ml" } }))).not.toBeNull();
    expect(parseSharingReply(reply({ type: "open", request: { kind: "manageLinks" } }))).not.toBeNull();
  });

  it("rejects malformed replies", () => {
    expect(parseSharingReply({ type: "result", id: 1, ok: true, value: 1 })).toBeNull();
    expect(parseSharingReply(reply({ type: "result", id: 1, ok: false }))).toBeNull();
    expect(parseSharingReply(reply({ type: "progress", id: 1, progress: { stage: "flying" } }))).toBeNull();
    expect(parseSharingReply(reply({ type: "offers", offers: { projects: "yes", links: false }, place: "x" }))).toBeNull();
    expect(parseSharingReply(reply({ type: "offers", offers: { projects: true, links: false } }))).toBeNull();
    expect(parseSharingReply(reply({ type: "open", request: { kind: "explode" } }))).toBeNull();
    expect(parseSharingReply(reply({ type: "open", request: { kind: "joinProject", invite: 7 } }))).toBeNull();
  });
});
