import { createWebviewConsult } from "../../../../src/writing/sourceEditor/webview/consultPorts";

type Sent = { type: string; id?: number; key?: string; request?: unknown; ref?: unknown; message?: any };

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const sent: Sent[] = [];
  const consult = createWebviewConsult(((message: Sent) => { sent.push(message); }) as never);
  const receive = (message: unknown): void => consult.receive(message as never);
  const last = (type: string): Sent => {
    const found = [...sent].reverse().find((m) => m.type === type);
    if (!found) { throw new Error(`no ${type} posted`); }
    return found;
  };
  return { sent, consult, receive, last };
}

const manuscriptRef = { kind: "manuscript", projectId: "p1", path: "main.tex" } as const;
const notesRef = { kind: "paperNotes", paperId: "paper1" } as const;
const update = { clientID: "c", changes: [[0, "x"]] } as never;

async function openText(s: ReturnType<typeof setup>, over: Record<string, unknown> = {}) {
  const promise = s.consult.openFile(manuscriptRef);
  await tick();
  const request = s.last("consultFile");
  s.receive({
    type: "consultFileReply", id: request.id, key: request.key,
    file: { kind: "text", path: "main.tex", text: "abc\ndef", lineBreak: "\n", version: 5, dirty: true, ...over },
  });
  const file = await promise;
  return { file, key: request.key as string };
}

async function openQmd(s: ReturnType<typeof setup>) {
  const promise = s.consult.openFile(notesRef);
  await tick();
  const request = s.last("consultFile");
  s.receive({ type: "consultFileReply", id: request.id, key: request.key, file: { kind: "qmd", path: "notes.qmd", text: "# Notes" } });
  const file = await promise;
  return { file, key: request.key as string };
}

describe("9.2 The VS Code source editor webview shows the consult footer and opens the chooser, papers read-only and notes, manuscripts and code editable, over 9.1's envelopes.", () => {
  it("9.2a client posts a consult envelope and resolves with the reply of the same id", async () => {
    const s = setup();
    const request = { kind: "list", what: "paper" } as const;
    const pending = s.consult.client(request);
    await tick();
    const posted = s.last("consult");
    expect(posted.request).toEqual(request);
    expect(typeof posted.id).toBe("number");
    const reply = { ok: true, value: { kind: "entries", entries: [], canBrowse: false } };
    s.receive({ type: "consultReply", id: posted.id, reply });
    await expect(pending).resolves.toEqual(reply);
  });

  it("9.2a two requests in flight resolve with their own replies", async () => {
    const s = setup();
    const first = s.consult.client({ kind: "paperPdf", paperId: "a" });
    const second = s.consult.client({ kind: "paperPdf", paperId: "b" });
    await tick();
    const posted = s.sent.filter((m) => m.type === "consult");
    expect(posted).toHaveLength(2);
    expect(posted[0]!.id).not.toBe(posted[1]!.id);
    const forB = posted.find((m) => (m.request as { paperId: string }).paperId === "b")!;
    const forA = posted.find((m) => (m.request as { paperId: string }).paperId === "a")!;
    s.receive({ type: "consultReply", id: forB.id, reply: { ok: true, value: { kind: "pdf", base64: "BBB" } } });
    s.receive({ type: "consultReply", id: forA.id, reply: { ok: true, value: { kind: "pdf", base64: "AAA" } } });
    await expect(first).resolves.toEqual({ ok: true, value: { kind: "pdf", base64: "AAA" } });
    await expect(second).resolves.toEqual({ ok: true, value: { kind: "pdf", base64: "BBB" } });
  });

  it("9.2a a reply for an unknown id is ignored", async () => {
    const s = setup();
    expect(() => s.receive({ type: "consultReply", id: 987654, reply: { ok: false, error: "x" } })).not.toThrow();
    const pending = s.consult.client({ kind: "browse" });
    await tick();
    const posted = s.last("consult");
    s.receive({ type: "consultReply", id: posted.id! + 1000, reply: { ok: false, error: "wrong" } });
    s.receive({ type: "consultReply", id: posted.id, reply: { ok: true, value: { kind: "picked", entry: null } } });
    await expect(pending).resolves.toEqual({ ok: true, value: { kind: "picked", entry: null } });
  });

  it("9.2b openFile of a text ref posts consultFile with the ref and resolves a text EditableFile from the init", async () => {
    const s = setup();
    const { file, key } = await openText(s);
    expect(s.last("consultFile").ref).toEqual(manuscriptRef);
    expect(typeof key).toBe("string");
    expect(file.kind).toBe("text");
    expect(file.path).toBe("main.tex");
    const document = (file.binding as { document: any }).document;
    expect(document.text).toBe("abc\ndef");
    expect(document.lineBreak).toBe("\n");
    expect(document.version).toBe(5);
    expect(document.dirty).toBe(true);
  });

  it("9.2b the document's push and save post consultDoc under the file's key", async () => {
    const s = setup();
    const { file, key } = await openText(s);
    const document = (file.binding as { document: any }).document;
    document.push(5, [update]);
    document.save();
    const docs = s.sent.filter((m) => m.type === "consultDoc");
    expect(docs).toEqual([
      { type: "consultDoc", key, message: { type: "push", version: 5, updates: [update] } },
      { type: "consultDoc", key, message: { type: "save" } },
    ]);
  });

  it("9.2b consultDoc updates, resync and dirty under the key reach the document's listeners", async () => {
    const s = setup();
    const { file, key } = await openText(s);
    const document = (file.binding as { document: any }).document;
    const l = { updates: jest.fn(), resync: jest.fn(), dirty: jest.fn() };
    document.subscribe(l);
    s.receive({ type: "consultDoc", key, message: { type: "updates", version: 6, updates: [update] } });
    s.receive({ type: "consultDoc", key, message: { type: "resync", text: "new", version: 8 } });
    s.receive({ type: "consultDoc", key, message: { type: "dirty", dirty: false } });
    expect(l.updates).toHaveBeenCalledWith(6, [update]);
    expect(l.resync).toHaveBeenCalledWith("new", 8);
    expect(l.dirty).toHaveBeenCalledWith(false);
  });

  it("9.2b updates under another key do not reach the document's listeners", async () => {
    const s = setup();
    const { file, key } = await openText(s);
    const document = (file.binding as { document: any }).document;
    const l = { updates: jest.fn(), resync: jest.fn(), dirty: jest.fn() };
    document.subscribe(l);
    s.receive({ type: "consultDoc", key: `${key}-other`, message: { type: "updates", version: 6, updates: [update] } });
    expect(l.updates).not.toHaveBeenCalled();
  });

  it("9.2b two open files get different keys and each receives only its own updates", async () => {
    const s = setup();
    const a = await openText(s);
    const b = await openText(s);
    expect(a.key).not.toBe(b.key);
    const la = { updates: jest.fn(), resync: jest.fn(), dirty: jest.fn() };
    const lb = { updates: jest.fn(), resync: jest.fn(), dirty: jest.fn() };
    (a.file.binding as { document: any }).document.subscribe(la);
    (b.file.binding as { document: any }).document.subscribe(lb);
    s.receive({ type: "consultDoc", key: b.key, message: { type: "updates", version: 6, updates: [update] } });
    expect(la.updates).not.toHaveBeenCalled();
    expect(lb.updates).toHaveBeenCalledTimes(1);
  });

  it("9.2c openFile of a qmd ref resolves a qmd EditableFile whose binding starts from the init text", async () => {
    const s = setup();
    const { file } = await openQmd(s);
    expect(s.last("consultFile").ref).toEqual(notesRef);
    expect(file.kind).toBe("qmd");
    expect(file.path).toBe("notes.qmd");
    expect((file.binding as { text: string }).text).toBe("# Notes");
  });

  it("9.2c save and create post saveItem and createItem under the file's key", async () => {
    const s = setup();
    const { file, key } = await openQmd(s);
    const binding = file.binding as { save(id: string, body: string): unknown; create(id: string, body: string): unknown };
    await binding.save("item1", "body one");
    await binding.create("item2", "body two");
    const docs = s.sent.filter((m) => m.type === "consultDoc");
    expect(docs).toEqual([
      { type: "consultDoc", key, message: { type: "saveItem", itemId: "item1", body: "body one" } },
      { type: "consultDoc", key, message: { type: "createItem", itemId: "item2", body: "body two" } },
    ]);
  });

  it("9.2c update messages under the key reach subscribe listeners until unsubscribed", async () => {
    const s = setup();
    const { file, key } = await openQmd(s);
    const binding = file.binding as { subscribe(l: (text: string) => void): () => void };
    const listener = jest.fn();
    const unsubscribe = binding.subscribe(listener);
    s.receive({ type: "consultDoc", key, message: { type: "update", text: "one" } });
    expect(listener).toHaveBeenCalledWith("one");
    unsubscribe();
    s.receive({ type: "consultDoc", key, message: { type: "update", text: "two" } });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("9.2c update messages under another key do not reach a qmd listener", async () => {
    const s = setup();
    const { file, key } = await openQmd(s);
    const binding = file.binding as { subscribe(l: (text: string) => void): () => void };
    const listener = jest.fn();
    binding.subscribe(listener);
    s.receive({ type: "consultDoc", key: `${key}-other`, message: { type: "update", text: "x" } });
    expect(listener).not.toHaveBeenCalled();
  });

  it("9.2d an error reply rejects openFile with its sentence", async () => {
    const s = setup();
    const promise = s.consult.openFile({ kind: "code", path: "/etc/passwd" });
    await tick();
    const request = s.last("consultFile");
    s.receive({ type: "consultFileReply", id: request.id, key: request.key, file: { error: "That file is outside the workspace." } });
    await expect(promise).rejects.toThrow("That file is outside the workspace.");
  });

  it("9.2d a consultFileReply for an unknown id is ignored", async () => {
    const s = setup();
    expect(() => s.receive({ type: "consultFileReply", id: 424242, key: "nope", file: { error: "x" } })).not.toThrow();
  });

  it("9.2d release posts consultRelease under the file's key once, however often it is called", async () => {
    const s = setup();
    const { file, key } = await openText(s);
    file.release();
    file.release();
    expect(s.sent.filter((m) => m.type === "consultRelease")).toEqual([{ type: "consultRelease", key }]);
  });

  it("9.2d after release, messages for the key are ignored", async () => {
    const s = setup();
    const { file, key } = await openText(s);
    const document = (file.binding as { document: any }).document;
    const l = { updates: jest.fn(), resync: jest.fn(), dirty: jest.fn() };
    document.subscribe(l);
    file.release();
    expect(() => s.receive({ type: "consultDoc", key, message: { type: "updates", version: 6, updates: [update] } })).not.toThrow();
    expect(l.updates).not.toHaveBeenCalled();
  });

  it("9.2d after release, qmd update messages for the key are ignored", async () => {
    const s = setup();
    const { file, key } = await openQmd(s);
    const listener = jest.fn();
    (file.binding as { subscribe(l: (text: string) => void): () => void }).subscribe(listener);
    file.release();
    s.receive({ type: "consultDoc", key, message: { type: "update", text: "late" } });
    expect(listener).not.toHaveBeenCalled();
    expect(s.sent.filter((m) => m.type === "consultRelease")).toHaveLength(1);
  });
});
