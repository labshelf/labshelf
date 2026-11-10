// Pins editor-prefs.json: its bytes, unknown keys kept, read-only files never written, and the store's change notices.
import type { ILogger } from "../../../src/ports/index";
import { DEFAULT_TYPING_HELPERS, EditorPrefsStore, parseEditorPrefs, serializeEditorPrefs, type EditorPrefsPort } from "../../../src/writing/typing/index";

const logger = (): ILogger & { log: jest.Mock } => ({ log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) });

function memoryPort(initial: string | null): EditorPrefsPort & { text: string | null; writes: number } {
  const port = {
    text: initial,
    writes: 0,
    read: async () => port.text,
    write: async (text: string) => { port.text = text; port.writes += 1; },
  };
  return port;
}

describe("parseEditorPrefs and serializeEditorPrefs", () => {
  it("reads a missing file as every helper on", () => {
    expect(parseEditorPrefs(null).typing).toEqual(DEFAULT_TYPING_HELPERS);
  });

  it("writes version 1, every helper, sorted keys and two-space indent, keeping unknown keys", () => {
    const prefs = parseEditorPrefs(JSON.stringify({ zeta: 1, typing: { brackets: false, future: "x" }, version: 1 }));
    expect(prefs.typing.brackets).toBe(false);
    expect(prefs.typing.quotes).toBe(true);
    const text = serializeEditorPrefs(prefs);
    const parsed = JSON.parse(text) as { typing: Record<string, unknown>; zeta: number; version: number };
    expect(Object.keys(parsed)).toEqual(["typing", "version", "zeta"]);
    expect(Object.keys(parsed.typing)).toEqual([...Object.keys(parsed.typing)].sort());
    expect(parsed.typing["future"]).toBe("x");
    expect(parsed.typing["brackets"]).toBe(false);
    expect(Object.keys(parsed.typing)).toHaveLength(13);
    expect(text).toContain('\n  "typing": {\n    "beginEnd": true,');
    expect(serializeEditorPrefs(parseEditorPrefs(text))).toBe(text);
  });

  it("makes a higher version or a non-JSON file read-only with the defaults", () => {
    expect(parseEditorPrefs('{"version":2,"typing":{"brackets":false}}')).toMatchObject({ typing: DEFAULT_TYPING_HELPERS, readOnlyReason: expect.stringContaining("version 2") });
    expect(parseEditorPrefs("{oops").readOnlyReason).toEqual(expect.any(String));
    expect(parseEditorPrefs("[]").readOnlyReason).toEqual(expect.any(String));
  });
});

describe("EditorPrefsStore", () => {
  it("saves the helpers and tells the listeners", async () => {
    const port = memoryPort(JSON.stringify({ other: true }));
    const store = new EditorPrefsStore(port, logger());
    const heard: boolean[] = [];
    store.onChange((typing) => heard.push(typing.brackets));
    await store.setTyping({ ...DEFAULT_TYPING_HELPERS, brackets: false });
    expect(JSON.parse(port.text!)).toMatchObject({ other: true, version: 1, typing: { brackets: false } });
    expect(heard).toEqual([false]);
    expect((await store.typing()).brackets).toBe(false);
  });

  it("does not write the same helpers again", async () => {
    const port = memoryPort(null);
    const store = new EditorPrefsStore(port, logger());
    await store.setTyping(DEFAULT_TYPING_HELPERS);
    expect(port.writes).toBe(0);
  });

  it("never writes a read-only file and logs a warning", async () => {
    const original = '{"version":3,"typing":{"brackets":false}}';
    const port = memoryPort(original);
    const log = logger();
    const store = new EditorPrefsStore(port, log);
    expect(await store.typing()).toEqual(DEFAULT_TYPING_HELPERS);
    await store.setTyping({ ...DEFAULT_TYPING_HELPERS, quotes: false });
    expect(port.text).toBe(original);
    expect(port.writes).toBe(0);
    expect(log.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.any(String), expect.anything());
  });

  it("notifies after an outside change only when the helpers differ", async () => {
    const port = memoryPort(null);
    const store = new EditorPrefsStore(port, logger());
    await store.typing();
    const heard: boolean[] = [];
    store.onChange((typing) => heard.push(typing.scripts));
    await store.changed();
    expect(heard).toEqual([]);
    port.text = JSON.stringify({ version: 1, typing: { scripts: false } });
    await store.changed();
    expect(heard).toEqual([false]);
  });
});
