import { createReaderWebviewConsult } from "../../../src/reader/webview/readerConsult";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const assets = { pdfjsUrl: "vscode-resource:/pdf.mjs", workerUrl: "vscode-resource:/pdf.worker.mjs" };

type Posted = { command?: string; message?: { type: string; id?: number; request?: unknown } };

function setup() {
  const posted: Posted[] = [];
  const consult = createReaderWebviewConsult({ post: (message) => { posted.push(message as Posted); } }, assets);
  const receive = (message: unknown): void => consult.receive(message);
  return { posted, consult, receive };
}

const init = (extra: Record<string, unknown> = {}) => ({ type: "init", reading: null, annotations: [], notes: [], ...extra });

describe("10.2 The VS Code reader webview builds the consult over the reader channel", () => {
  it("10.2a posts {command:'consult', message} for a client request", async () => {
    const s = setup();
    const request = { kind: "list", what: "paper" } as const;
    const { client } = (await withConsult(s));
    void client(request);
    await tick();
    expect(s.posted).toHaveLength(1);
    expect(s.posted[0]).toEqual({ command: "consult", message: { type: "consult", id: expect.any(Number), request } });
  });

  it("10.2a resolves the request with the consultReply of the same id fed through receive", async () => {
    const s = setup();
    const { client } = await withConsult(s);
    const pending = client({ kind: "list", what: "paper" });
    await tick();
    const id = s.posted[0]!.message!.id;
    const reply = { ok: true, value: { kind: "entries", entries: [], canBrowse: false } } as const;
    s.receive({ type: "consultReply", id, reply });
    await expect(pending).resolves.toEqual(reply);
  });

  it("10.2a keeps concurrent requests apart by id", async () => {
    const s = setup();
    const { client } = await withConsult(s);
    const first = client({ kind: "list", what: "paper" });
    const second = client({ kind: "browse" });
    await tick();
    const [a, b] = s.posted.map((p) => p.message!.id);
    expect(a).not.toBe(b);
    s.receive({ type: "consultReply", id: b, reply: { ok: false, error: "second" } });
    s.receive({ type: "consultReply", id: a, reply: { ok: false, error: "first" } });
    await expect(first).resolves.toEqual({ ok: false, error: "first" });
    await expect(second).resolves.toEqual({ ok: false, error: "second" });
  });

  it("10.2a wraps a file open as {command:'consult', message} too", async () => {
    const s = setup();
    const { openFile } = await withConsult(s);
    const ref = { kind: "paperNotes", paperId: "paper1" } as const;
    void openFile(ref);
    await tick();
    expect(s.posted[0]).toEqual({ command: "consult", message: { type: "consultFile", id: expect.any(Number), key: expect.any(String), ref } });
  });

  it("10.2a ignores messages that are not consult inbound", async () => {
    const s = setup();
    const { client } = await withConsult(s);
    const pending = client({ kind: "browse" });
    await tick();
    const id = s.posted[0]!.message!.id;
    s.receive({ type: "theme", id });
    s.receive(null);
    s.receive("consultReply");
    s.receive({ type: "consultReply", id, reply: "nonsense" });
    const reply = { ok: false, error: "late" } as const;
    s.receive({ type: "consultReply", id, reply });
    await expect(pending).resolves.toEqual(reply);
  });

  it("10.2b setup resolves a setup after an init with hasConsult true", async () => {
    const s = setup();
    const pending = s.consult.setup();
    s.receive(init({ hasConsult: true }));
    const found = await pending;
    expect(found).toBeDefined();
    expect(typeof found!.client).toBe("function");
    expect(typeof found!.openFile).toBe("function");
    expect(typeof found!.pdfSource).toBe("function");
  });

  it("10.2b setup resolves undefined after an init without hasConsult", async () => {
    const s = setup();
    const pending = s.consult.setup();
    s.receive(init());
    await expect(pending).resolves.toBeUndefined();
  });

  it("10.2b setup resolves undefined after an init with hasConsult false", async () => {
    const s = setup();
    const pending = s.consult.setup();
    s.receive(init({ hasConsult: false }));
    await expect(pending).resolves.toBeUndefined();
  });

  it("10.2b setup called after the init has arrived still resolves from it", async () => {
    const withIt = setup();
    withIt.receive(init({ hasConsult: true }));
    await expect(withIt.consult.setup()).resolves.toBeDefined();
    const without = setup();
    without.receive(init());
    await expect(without.consult.setup()).resolves.toBeUndefined();
  });

  it("10.2b setup stays pending until an init arrives", async () => {
    const s = setup();
    let settled = false;
    void s.consult.setup().then(() => { settled = true; });
    s.receive({ type: "consultReply", id: 0, reply: { ok: false, error: "x" } });
    await tick();
    expect(settled).toBe(false);
    s.receive(init({ hasConsult: true }));
    await tick();
    expect(settled).toBe(true);
  });

  it("10.2b setup follows the first init only", async () => {
    const s = setup();
    const pending = s.consult.setup();
    s.receive(init({ hasConsult: true }));
    s.receive(init());
    await expect(pending).resolves.toBeDefined();
  });

  it("10.2b pdfSource serves the assets and a copy of the bytes", async () => {
    const s = setup();
    const found = (await withConsult(s));
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const source = found.pdfSource!(bytes);
    expect(source.assets).toBe(assets);
    const read = await source.readBytes();
    expect(new Uint8Array(read)).toEqual(new Uint8Array([1, 2, 3]));
    expect(read).not.toBe(bytes);
  });
});

async function withConsult(s: ReturnType<typeof setup>) {
  const pending = s.consult.setup();
  s.receive(init({ hasConsult: true }));
  const found = await pending;
  if (!found) { throw new Error("no consult setup"); }
  s.posted.length = 0;
  return found;
}
