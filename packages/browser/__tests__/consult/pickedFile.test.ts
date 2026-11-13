import { createPickedFiles } from "../../src/consult/pickedFile";

type Win = { showOpenFilePicker?: (options?: unknown) => Promise<unknown[]> };
const setWindow = (value: Win | undefined): void => {
  if (value === undefined) { delete (globalThis as { window?: unknown }).window; } else { (globalThis as { window?: unknown }).window = value; }
};

interface FakeHandle {
  readonly name: string;
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: unknown): Promise<void>; close(): Promise<void> }>;
}

/** A file handle over a text; every createWritable stream commits the whole text it was given when it closes. */
function fakeHandle(name: string, initial: string): FakeHandle & { disk: () => string; writables: () => number } {
  let disk = initial;
  let writables = 0;
  return {
    name,
    getFile: async () => ({ text: async () => disk }),
    createWritable: async () => {
      writables += 1;
      let pending = "";
      return {
        write: async (data: unknown) => {
          pending += typeof data === "string" ? data : String((data as { data?: unknown }).data ?? "");
        },
        close: async () => { disk = pending; },
      };
    },
    disk: () => disk,
    writables: () => writables,
  };
}

const settle = async (): Promise<void> => { await jest.advanceTimersByTimeAsync(0); };

describe("9.3 picked files", () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => {
    jest.useRealTimers();
    setWindow(undefined);
  });

  it("9.3d available is false without showOpenFilePicker", () => {
    setWindow({});
    expect(createPickedFiles().available).toBe(false);
  });

  it("9.3d available is true with showOpenFilePicker", () => {
    setWindow({ showOpenFilePicker: async () => [] });
    expect(createPickedFiles().available).toBe(true);
  });

  it("9.3d pick keeps the handle under a fresh id and returns its name", async () => {
    const a = fakeHandle("a.py", "1");
    const b = fakeHandle("b.py", "2");
    const queue = [a, b];
    setWindow({ showOpenFilePicker: async () => [queue.shift()] });
    const picked = createPickedFiles();
    const first = await picked.pick();
    const second = await picked.pick();
    expect(first).toMatchObject({ name: "a.py" });
    expect(second).toMatchObject({ name: "b.py" });
    expect(first!.id).not.toBe(second!.id);
    const file = await picked.open(first!.id);
    expect(file.path).toBe("a.py");
    expect(file.kind).toBe("text");
    file.release();
  });

  it("9.3d pick is null when the user cancels", async () => {
    setWindow({ showOpenFilePicker: async () => { throw new DOMException("cancelled", "AbortError"); } });
    expect(await createPickedFiles().pick()).toBeNull();
  });

  it("9.3d open reads the file's text into a text binding", async () => {
    const handle = fakeHandle("data.R", "x <- 1\n");
    setWindow({ showOpenFilePicker: async () => [handle] });
    const picked = createPickedFiles();
    const entry = await picked.pick();
    const file = await picked.open(entry!.id);
    if (file.kind !== "text" || !("collab" in file.binding)) { throw new Error("expected a collab text binding"); }
    expect(file.binding.collab.text.toString()).toBe("x <- 1\n");
    file.release();
  });

  it("9.3d an edit writes the whole text through createWritable 300 ms after the last change", async () => {
    const handle = fakeHandle("data.R", "abc");
    setWindow({ showOpenFilePicker: async () => [handle] });
    const picked = createPickedFiles();
    const entry = await picked.pick();
    const file = await picked.open(entry!.id);
    if (file.kind !== "text" || !("collab" in file.binding)) { throw new Error("expected a collab text binding"); }
    const text = file.binding.collab.text;
    text.insert(3, "d");
    await jest.advanceTimersByTimeAsync(200);
    text.insert(4, "e");
    await jest.advanceTimersByTimeAsync(299);
    expect(handle.writables()).toBe(0);
    expect(handle.disk()).toBe("abc");
    await jest.advanceTimersByTimeAsync(1);
    await settle();
    expect(handle.writables()).toBe(1);
    expect(handle.disk()).toBe("abcde");
    file.release();
  });

  it("9.3d release flushes a pending write once and stops observing", async () => {
    const handle = fakeHandle("data.R", "abc");
    setWindow({ showOpenFilePicker: async () => [handle] });
    const picked = createPickedFiles();
    const entry = await picked.pick();
    const file = await picked.open(entry!.id);
    if (file.kind !== "text" || !("collab" in file.binding)) { throw new Error("expected a collab text binding"); }
    const text = file.binding.collab.text;
    text.insert(3, "!");
    file.release();
    await settle();
    expect(handle.disk()).toBe("abc!");
    expect(handle.writables()).toBe(1);
    file.release();
    text.insert(4, "?");
    await jest.advanceTimersByTimeAsync(1000);
    expect(handle.disk()).toBe("abc!");
    expect(handle.writables()).toBe(1);
  });

  it("9.3d release with nothing pending writes nothing", async () => {
    const handle = fakeHandle("data.R", "abc");
    setWindow({ showOpenFilePicker: async () => [handle] });
    const picked = createPickedFiles();
    const entry = await picked.pick();
    const file = await picked.open(entry!.id);
    file.release();
    await jest.advanceTimersByTimeAsync(1000);
    expect(handle.writables()).toBe(0);
  });

  it("9.3d a second open of the same id gets its own doc", async () => {
    const handle = fakeHandle("data.R", "abc");
    setWindow({ showOpenFilePicker: async () => [handle] });
    const picked = createPickedFiles();
    const entry = await picked.pick();
    const one = await picked.open(entry!.id);
    const two = await picked.open(entry!.id);
    if (one.kind !== "text" || !("collab" in one.binding) || two.kind !== "text" || !("collab" in two.binding)) { throw new Error("expected collab text bindings"); }
    expect(one.binding.collab.text.doc).not.toBe(two.binding.collab.text.doc);
    one.release();
    two.release();
  });

  it("9.3d open of an id that was never picked rejects", async () => {
    setWindow({ showOpenFilePicker: async () => [] });
    await expect(createPickedFiles().open("nope")).rejects.toBeDefined();
  });
});
