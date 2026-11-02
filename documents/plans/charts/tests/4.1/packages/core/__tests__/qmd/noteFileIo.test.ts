/**
 * Tests the shared note file functions (plan charts, spec 4.1a, D4/D5): answerNoteFileRequest and noteFilesPortFor over an
 * in-memory file system and a fake picker.
 */
import { answerNoteFileRequest, noteFilesPortFor, type NoteFileIo } from "../../src/qmd/noteFileIo";
import type { NoteFileRequest } from "../../src/qmd/noteFiles";

const FOLDER = "papers/p1";
const CSV = "t,v\n1,2\n3,4\n";
const b64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");
const MAX = 10 * 1024 * 1024;

interface Rig {
  io: NoteFileIo;
  files: Map<string, Uint8Array>;
  dirs: Set<string>;
  calls: string[];
  picks: (readonly string[])[];
}

/** An in-memory fs where writeFile fails when the parent directory was never ensured, so write order is observable. */
function rig(options: { pick?: () => Promise<{ name: string; text: string } | null>; failWrite?: string } = {}): Rig {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const calls: string[] = [];
  const picks: (readonly string[])[] = [];
  const parent = (path: string): string => path.slice(0, path.lastIndexOf("/"));
  const io: NoteFileIo = {
    fs: {
      stat: async (path) => {
        calls.push(`stat ${path}`);
        if (files.has(path)) { return { isFile: true, isDirectory: false, mtimeMs: 0, size: files.get(path)!.length }; }
        if (dirs.has(path)) { return { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 }; }
        return undefined;
      },
      readFile: async (path) => {
        calls.push(`readFile ${path}`);
        const bytes = files.get(path);
        if (bytes === undefined) { throw new Error(`ENOENT ${path}`); }
        return bytes;
      },
      writeFile: async (path, content) => {
        calls.push(`writeFile ${path}`);
        if (options.failWrite !== undefined) { throw new Error(options.failWrite); }
        if (!dirs.has(parent(path))) { throw new Error(`ENOENT directory ${parent(path)}`); }
        files.set(path, content);
      },
      ensureDir: async (path) => {
        calls.push(`ensureDir ${path}`);
        const parts = path.split("/");
        for (let i = 1; i <= parts.length; i += 1) { dirs.add(parts.slice(0, i).join("/")); }
      },
    },
    join: (...parts) => parts.join("/"),
    pick: async (accept) => { picks.push(accept); return options.pick ? options.pick() : null; },
  };
  return { io, files, dirs, calls, picks };
}

const read = (path: string, requestId = "r1"): NoteFileRequest => ({ type: "noteFile.read", requestId, path });
const write = (path: string, text: string, requestId = "r2"): NoteFileRequest => ({ type: "noteFile.write", requestId, path, base64: b64(text) });
const pick = (requestId = "r3"): NoteFileRequest => ({ type: "noteFile.pick", requestId, accept: [".csv", ".tsv"] });

describe("answerNoteFileRequest", () => {
  it("4.1a write puts the bytes at papers/p1/assets/c.csv and answers a reply with the requestId and no error", async () => {
    const { io, files } = rig();
    const reply = await answerNoteFileRequest(io, FOLDER, write("assets/c.csv", CSV));
    expect(reply).toEqual({ type: "noteFile.reply", requestId: "r2" });
    expect(Buffer.from(files.get("papers/p1/assets/c.csv")!).toString("utf8")).toBe(CSV);
  });

  it("4.1a write creates the missing assets folder before writing the file", async () => {
    const { io, calls } = rig();
    await answerNoteFileRequest(io, FOLDER, write("assets/c.csv", CSV));
    const ensured = calls.findIndex((call) => call.startsWith("ensureDir "));
    const written = calls.findIndex((call) => call === "writeFile papers/p1/assets/c.csv");
    expect(ensured).toBeGreaterThanOrEqual(0);
    expect(written).toBeGreaterThan(ensured);
    expect(calls[ensured]).toBe("ensureDir papers/p1/assets");
  });

  it("4.1a read answers the same bytes back as base64", async () => {
    const { io } = rig();
    await answerNoteFileRequest(io, FOLDER, write("assets/c.csv", CSV));
    const reply = await answerNoteFileRequest(io, FOLDER, read("assets/c.csv", "r9"));
    expect(reply).toEqual({ type: "noteFile.reply", requestId: "r9", base64: b64(CSV) });
  });

  it("4.1a read keeps non-text bytes intact", async () => {
    const { io, files } = rig();
    const bytes = new Uint8Array([0, 255, 128, 10, 13, 7]);
    files.set("papers/p1/assets/bin.csv", bytes);
    const reply = await answerNoteFileRequest(io, FOLDER, read("assets/bin.csv"));
    expect(Buffer.from(reply.base64 as string, "base64")).toEqual(Buffer.from(bytes));
  });

  it("4.1a read of a missing file answers base64 null without an error", async () => {
    const { io } = rig();
    const reply = await answerNoteFileRequest(io, FOLDER, read("assets/missing.csv"));
    expect(reply).toEqual({ type: "noteFile.reply", requestId: "r1", base64: null });
  });

  it("4.1a read of a folder answers base64 null", async () => {
    const { io, dirs } = rig();
    dirs.add("papers/p1/assets/sub");
    const reply = await answerNoteFileRequest(io, FOLDER, read("assets/sub"));
    expect(reply).toEqual({ type: "noteFile.reply", requestId: "r1", base64: null });
  });

  it.each(["assets/../x.csv", "../x.csv", "/x.csv", "C:/x.csv", "x.csv"])("4.1a read of %s answers an error and never touches the fs", async (path) => {
    const { io, calls } = rig();
    const reply = await answerNoteFileRequest(io, FOLDER, read(path));
    expect(reply.type).toBe("noteFile.reply");
    expect(reply.requestId).toBe("r1");
    expect(typeof reply.error).toBe("string");
    expect(reply.error!.length).toBeGreaterThan(0);
    expect(reply.base64).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("4.1a write to assets/../x.csv answers an error and never touches the fs", async () => {
    const { io, calls, files } = rig();
    const reply = await answerNoteFileRequest(io, FOLDER, write("assets/../x.csv", CSV));
    expect(typeof reply.error).toBe("string");
    expect(calls).toEqual([]);
    expect(files.size).toBe(0);
  });

  it("4.1a a write that fails in the fs answers the error message instead of rejecting", async () => {
    const { io } = rig({ failWrite: "disk full" });
    await expect(answerNoteFileRequest(io, FOLDER, write("assets/c.csv", CSV))).resolves.toEqual({ type: "noteFile.reply", requestId: "r2", error: "disk full" });
  });

  it("4.1a pick passes the picked file through and hands the accept list to io.pick", async () => {
    const { io, picks } = rig({ pick: async () => ({ name: "data.csv", text: "a,b\n1,2\n" }) });
    const reply = await answerNoteFileRequest(io, FOLDER, pick());
    expect(reply).toEqual({ type: "noteFile.reply", requestId: "r3", file: { name: "data.csv", text: "a,b\n1,2\n" } });
    expect(picks).toEqual([[".csv", ".tsv"]]);
  });

  it("4.1a pick answers file null when the user cancels", async () => {
    const { io } = rig({ pick: async () => null });
    expect(await answerNoteFileRequest(io, FOLDER, pick())).toEqual({ type: "noteFile.reply", requestId: "r3", file: null });
  });

  it("4.1a pick of a text over 10 MB answers the error 'File is larger than 10 MB'", async () => {
    const { io } = rig({ pick: async () => ({ name: "big.csv", text: "x".repeat(MAX + 1) }) });
    const reply = await answerNoteFileRequest(io, FOLDER, pick());
    expect(reply).toEqual({ type: "noteFile.reply", requestId: "r3", error: "File is larger than 10 MB" });
  });

  it("4.1a pick of a text of exactly 10 MB is passed through", async () => {
    const text = "x".repeat(MAX);
    const { io } = rig({ pick: async () => ({ name: "edge.csv", text }) });
    const reply = await answerNoteFileRequest(io, FOLDER, pick());
    expect(reply.error).toBeUndefined();
    expect(reply.file?.name).toBe("edge.csv");
    expect(reply.file?.text.length).toBe(MAX);
  });

  it("4.1a a picker that throws answers the error instead of rejecting", async () => {
    const { io } = rig({ pick: async () => { throw new Error("dialog crashed"); } });
    expect(await answerNoteFileRequest(io, FOLDER, pick())).toEqual({ type: "noteFile.reply", requestId: "r3", error: "dialog crashed" });
  });
});

describe("noteFilesPortFor", () => {
  it("4.1a write then read round-trips the bytes under the folder", async () => {
    const { io, files } = rig();
    const port = noteFilesPortFor(io, FOLDER);
    await port.write("assets/c.csv", new Uint8Array(Buffer.from(CSV, "utf8")));
    expect(files.has("papers/p1/assets/c.csv")).toBe(true);
    const bytes = await port.read("assets/c.csv");
    expect(Buffer.from(bytes!).toString("utf8")).toBe(CSV);
  });

  it("4.1a read resolves null for a missing file", async () => {
    const { io } = rig();
    await expect(noteFilesPortFor(io, FOLDER).read("assets/none.csv")).resolves.toBeNull();
  });

  it("4.1a read of assets/../x.csv rejects with 'Refused note file path' and does not touch the fs", async () => {
    const { io, calls } = rig();
    await expect(noteFilesPortFor(io, FOLDER).read("assets/../x.csv")).rejects.toThrow("Refused note file path assets/../x.csv");
    expect(calls).toEqual([]);
  });

  it("4.1a write of an unsafe path rejects and writes nothing", async () => {
    const { io, calls } = rig();
    await expect(noteFilesPortFor(io, FOLDER).write("../x.csv", new Uint8Array([1]))).rejects.toThrow("Refused note file path");
    expect(calls).toEqual([]);
  });

  it("4.1a pickTextFile returns what io.pick returns", async () => {
    const { io } = rig({ pick: async () => ({ name: "d.tsv", text: "a\tb\n" }) });
    await expect(noteFilesPortFor(io, FOLDER).pickTextFile([".tsv"])).resolves.toEqual({ name: "d.tsv", text: "a\tb\n" });
  });

  it("4.1a pickTextFile rejects with 'File is larger than 10 MB' for a text over the limit", async () => {
    const { io } = rig({ pick: async () => ({ name: "big.csv", text: "x".repeat(MAX + 1) }) });
    await expect(noteFilesPortFor(io, FOLDER).pickTextFile([".csv"])).rejects.toThrow("File is larger than 10 MB");
  });
});
