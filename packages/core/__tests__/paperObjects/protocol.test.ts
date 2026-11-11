/** Contract of the paper-object request/reply pair: every op round-trips through client → answer → client, errors keep their message, the guards refuse malformed shapes. */
import {
  answerPaperObjectsRequest, createPaperObjectsClient, isPaperObjectsReply, isPaperObjectsRequest, unsupportedPaperObjectsReply,
  type PaperObject, type PaperObjectsPort, type PaperObjectsRequest,
} from "../../src/paperObjects/index";

const OBJECT: PaperObject = { kind: "figure", label: "2", page: 1, box: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 }, caption: "Figure 2. A plot." };
const PNG = new Uint8Array([137, 80, 78, 71, 0, 255]);

function fakePort(overrides: Partial<PaperObjectsPort> = {}): PaperObjectsPort & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    papers: async (query) => { calls.push(["papers", query]); return [{ id: "p1", citeKey: "k2020", title: "A paper", authors: "Doe", year: "2020" }, { id: "p2", citeKey: null, title: "B", authors: "", year: null }]; },
    list: async (paperId) => { calls.push(["list", paperId]); return [OBJECT]; },
    preview: async (paperId, object) => { calls.push(["preview", paperId, object]); return PNG; },
    insert: async (paperId, object, options) => { calls.push(["insert", paperId, object, options]); return { markdown: "![Figure 2](assets/a1.png)", assets: [{ path: "assets/a1.png", bytes: PNG }], via: "image" }; },
    ...overrides,
  };
}

/** A client wired to `port` through JSON, as a webview's postMessage would carry it; `posted` records every request. */
function wire(port: PaperObjectsPort) {
  const listeners = new Set<(message: unknown) => void>();
  const posted: unknown[] = [];
  const client = createPaperObjectsClient((request) => {
    const sent = JSON.parse(JSON.stringify(request)) as unknown;
    posted.push(sent);
    if (!isPaperObjectsRequest(sent)) { throw new Error("client posted a malformed request"); }
    void answerPaperObjectsRequest(port, sent).then((reply) => {
      const received = JSON.parse(JSON.stringify(reply)) as unknown;
      for (const listener of [...listeners]) { listener(received); }
    });
  }, (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; });
  return { client, posted, listeners };
}

describe("paper objects protocol round trip", () => {
  test("papers, list, preview and insert reach the port and come back with bytes intact", async () => {
    const port = fakePort();
    const { client, listeners } = wire(port);
    expect(await client.papers("doe")).toEqual([
      { id: "p1", citeKey: "k2020", title: "A paper", authors: "Doe", year: "2020" },
      { id: "p2", citeKey: null, title: "B", authors: "", year: null },
    ]);
    expect(await client.list("p1")).toEqual([OBJECT]);
    expect(await client.preview("p1", OBJECT)).toEqual(PNG);
    const insert = await client.insert("p1", OBJECT, { assetName: "a1", takenLabels: ["1"], asImage: true });
    expect(insert).toEqual({ markdown: "![Figure 2](assets/a1.png)", assets: [{ path: "assets/a1.png", bytes: PNG }], via: "image" });
    expect(insert.assets[0]!.bytes).toBeInstanceOf(Uint8Array);
    expect(port.calls).toEqual([
      ["papers", "doe"], ["list", "p1"], ["preview", "p1", OBJECT], ["insert", "p1", OBJECT, { assetName: "a1", takenLabels: ["1"], asImage: true }],
    ]);
    expect(listeners.size).toBe(0);
  });

  test("a null preview stays null", async () => {
    const { client } = wire(fakePort({ preview: async () => null }));
    expect(await client.preview("p1", OBJECT)).toBeNull();
  });

  test("a rejection reaches the caller with its message as is", async () => {
    const { client } = wire(fakePort({ list: async () => { throw new Error("This paper has no PDF."); } }));
    await expect(client.list("p1")).rejects.toThrow(new Error("This paper has no PDF."));
  });

  test("answer never rejects: a thrown non-Error becomes the reply's error", async () => {
    const request: PaperObjectsRequest = { type: "paperObjects.request", requestId: "r1", call: { op: "papers", query: "" } };
    expect(await answerPaperObjectsRequest(fakePort({ papers: () => Promise.reject("boom") }), request)).toEqual({ type: "paperObjects.reply", requestId: "r1", error: "boom" });
  });

  test("replies with another requestId or a malformed value do not settle a call; a wrong shape for the op rejects", async () => {
    let listener: ((message: unknown) => void) | undefined;
    const posted: PaperObjectsRequest[] = [];
    const client = createPaperObjectsClient((request) => { posted.push(request); }, (l) => { listener = l; return () => { listener = undefined; }; });
    const list = client.list("p1");
    const requestId = posted[0]!.requestId;
    listener!({ type: "paperObjects.reply", requestId: "other", value: [] });
    listener!({ type: "paperObjects.reply", requestId, value: [{ kind: "figure" }] });
    expect(listener).toBeDefined();
    listener!({ type: "paperObjects.reply", requestId, value: "AAAA" });
    await expect(list).rejects.toThrow("Malformed paper objects reply");
    expect(listener).toBeUndefined();
  });

  test("the unsupported reply names the feature", () => {
    expect(unsupportedPaperObjectsReply({ requestId: "r9" })).toEqual({ type: "paperObjects.reply", requestId: "r9", error: "From paper is not available here." });
  });
});

describe("isPaperObjectsRequest", () => {
  const request = (call: unknown): unknown => ({ type: "paperObjects.request", requestId: "r1", call });
  const options = { assetName: "a1", takenLabels: [] };

  test("accepts each op", () => {
    expect(isPaperObjectsRequest(request({ op: "papers", query: "" }))).toBe(true);
    expect(isPaperObjectsRequest(request({ op: "list", paperId: "p1" }))).toBe(true);
    expect(isPaperObjectsRequest(request({ op: "preview", paperId: "p1", object: OBJECT }))).toBe(true);
    expect(isPaperObjectsRequest(request({ op: "insert", paperId: "p1", object: OBJECT, options: { ...options, asImage: false } }))).toBe(true);
  });

  test.each([
    ["wrong type", { type: "paperObjects.reply", requestId: "r1", call: { op: "papers", query: "" } }],
    ["empty requestId", { type: "paperObjects.request", requestId: "", call: { op: "papers", query: "" } }],
    ["unknown op", request({ op: "delete", paperId: "p1" })],
    ["query not a string", request({ op: "papers", query: 3 })],
    ["empty paperId", request({ op: "list", paperId: "" })],
    ["unknown kind", request({ op: "preview", paperId: "p1", object: { ...OBJECT, kind: "chart" } })],
    ["empty label", request({ op: "preview", paperId: "p1", object: { ...OBJECT, label: "" } })],
    ["page zero", request({ op: "preview", paperId: "p1", object: { ...OBJECT, page: 0 } })],
    ["fractional page", request({ op: "preview", paperId: "p1", object: { ...OBJECT, page: 1.5 } })],
    ["box over 1", request({ op: "preview", paperId: "p1", object: { ...OBJECT, box: { ...OBJECT.box, w: 1.2 } } })],
    ["negative box", request({ op: "preview", paperId: "p1", object: { ...OBJECT, box: { ...OBJECT.box, x: -0.1 } } })],
    ["NaN box", request({ op: "preview", paperId: "p1", object: { ...OBJECT, box: { ...OBJECT.box, y: Number.NaN } } })],
    ["missing caption", request({ op: "preview", paperId: "p1", object: { ...OBJECT, caption: undefined } })],
    ["missing options", request({ op: "insert", paperId: "p1", object: OBJECT })],
    ["empty assetName", request({ op: "insert", paperId: "p1", object: OBJECT, options: { ...options, assetName: "" } })],
    ["takenLabels not strings", request({ op: "insert", paperId: "p1", object: OBJECT, options: { ...options, takenLabels: [1] } })],
    ["asImage not boolean", request({ op: "insert", paperId: "p1", object: OBJECT, options: { ...options, asImage: "yes" } })],
  ])("refuses %s", (_name, value) => {
    expect(isPaperObjectsRequest(value)).toBe(false);
  });
});

describe("isPaperObjectsReply", () => {
  const reply = (fields: Record<string, unknown>): unknown => ({ type: "paperObjects.reply", requestId: "r1", ...fields });

  test("accepts errors and each value shape", () => {
    expect(isPaperObjectsReply(reply({ error: "This paper has no PDF." }))).toBe(true);
    expect(isPaperObjectsReply(reply({ value: [] }))).toBe(true);
    expect(isPaperObjectsReply(reply({ value: [OBJECT] }))).toBe(true);
    expect(isPaperObjectsReply(reply({ value: [{ id: "p1", citeKey: null, title: "T", authors: "A", year: null }] }))).toBe(true);
    expect(isPaperObjectsReply(reply({ value: null }))).toBe(true);
    expect(isPaperObjectsReply(reply({ value: "iVBORw==" }))).toBe(true);
    expect(isPaperObjectsReply(reply({ value: { markdown: "x", assets: [{ path: "assets/a.png", base64: "AA==" }], via: "ai" } }))).toBe(true);
  });

  test.each([
    ["wrong type", { type: "noteFile.reply", requestId: "r1", value: null }],
    ["empty requestId", { type: "paperObjects.reply", requestId: "", value: null }],
    ["error not a string", reply({ error: 3 })],
    ["error with a value", reply({ error: "x", value: null })],
    ["not base64", reply({ value: "not base64!" })],
    ["unknown via", reply({ value: { markdown: "x", assets: [], via: "ocr" } })],
    ["asset outside assets/", reply({ value: { markdown: "x", assets: [{ path: "../x.png", base64: "AA==" }], via: "image" } })],
    ["asset bytes not base64", reply({ value: { markdown: "x", assets: [{ path: "assets/a.png", base64: "%%" }], via: "image" } })],
    ["mixed list", reply({ value: [OBJECT, { id: "p1" }] })],
  ])("refuses %s", (_name, value) => {
    expect(isPaperObjectsReply(value)).toBe(false);
  });
});
