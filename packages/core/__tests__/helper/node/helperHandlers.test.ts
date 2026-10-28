/** Pins the helper's handlers: the answerer's replies and ordering, the project messages on the socket, the hello-and-session loop on stdio and the thumbnail replies that unblock a publication. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";

import type { ILogger } from "../../../src/ports/index.js";
import { PROTOCOL_VERSION } from "../../../src/helper/index.js";
import { createFrameWriter, type HelperServer } from "../../../src/helper/node/helperConnection.js";
import { answerHello, createHelperAnswerer, runHelperLoop, type HelloAnswer, type HelperHandlers } from "../../../src/helper/node/helperHandlers.js";
import type { HelperLogger } from "../../../src/helper/node/helperPrivacy.js";
import { createLibraryProjects, type LibraryProjects } from "../../../src/helper/node/helperProjects.js";
import { createProjectHandlers } from "../../../src/helper/node/projectHandlers.js";
import { decodeFrames, encodeFrame } from "./helperConnectionHarness.js";

const logs: string[] = [];
const logger = { log: async (_l: string, _m: string, message: string) => { logs.push(message); }, error: async (_m: string, e: unknown) => { logs.push(String(e)); } } as unknown as ILogger;

function setup(handlers: HelperHandlers) {
  const sent: Array<Record<string, unknown>> = [];
  const dispatcher = createHelperAnswerer(handlers, logger);
  const send = (envelope: Record<string, unknown>) => { sent.push(envelope); };
  const handle = (envelope: unknown) => dispatcher.handle(envelope as Record<string, unknown>, new Uint8Array(), send);
  return { sent, handle, drain: () => dispatcher.drain() };
}

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "labshelf-dispatch-"));
}

async function projectSetup(libraryRoot?: string) {
  const dir = await tempDir();
  const sharedConfigFile = path.join(dir, "config.json");
  if (libraryRoot) { await fs.writeFile(sharedConfigFile, JSON.stringify({ libraryRoot })); }
  const dataDir = path.join(dir, "data");
  const projects: LibraryProjects = createLibraryProjects({ sharedConfigFile, logger });
  const forgotten: string[] = [];
  return { dataDir, projects, forgotten, ...setup(createProjectHandlers({ dataDir, projects, forgetBuilds: (id) => { forgotten.push(id); } })) };
}

describe("createHelperAnswerer", () => {
  beforeEach(() => { logs.length = 0; });

  it("replies with the parser's code and the request id on a rejected message", async () => {
    const { sent, handle, drain } = setup({});
    handle({ v: 1, id: "5", type: "cancel", projectId: "p" });
    handle({ v: PROTOCOL_VERSION, id: "6", type: "cancel" });
    handle("nope");
    await drain();
    expect(sent).toMatchObject([{ type: "error", id: "5", code: "version" }, { type: "error", id: "6", code: "invalid-field" }, { type: "error", id: "0", code: "malformed" }]);
  });

  it("replies unknown-type for a message with no handler", async () => {
    const { sent, handle, drain } = setup({});
    handle({ v: PROTOCOL_VERSION, id: "3", type: "save", projectId: "p", path: "main.tex" });
    await drain();
    expect(sent).toMatchObject([{ type: "error", id: "3", code: "unknown-type" }]);
  });

  it("answers a throwing handler with an internal error and logs it", async () => {
    const { sent, handle, drain } = setup({ save: async () => { throw new Error("disk full"); } });
    handle({ v: PROTOCOL_VERSION, id: "4", type: "save", projectId: "p", path: "main.tex" });
    await drain();
    expect(sent).toMatchObject([{ type: "error", id: "4", code: "internal" }]);
    expect(logs.join("\n")).toContain("disk full");
  });

  it("runs messages in order but lets cancel overtake a running handler", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { handle, drain } = setup({
      compile: async () => { order.push("compile:start"); await gate; order.push("compile:end"); },
      save: async () => { order.push("save"); },
      cancel: async () => { order.push("cancel"); release(); },
    });
    handle({ v: PROTOCOL_VERSION, id: "1", type: "compile", projectId: "p", main: "main.tex", mode: "preview" });
    handle({ v: PROTOCOL_VERSION, id: "2", type: "save", projectId: "p", path: "main.tex" });
    handle({ v: PROTOCOL_VERSION, id: "3", type: "cancel", projectId: "p" });
    await drain();
    expect(order).toEqual(["compile:start", "cancel", "compile:end", "save"]);
  });
});

describe("project messages on the socket", () => {
  it("refuses openProject with no-library when no library is set up", async () => {
    const { sent, handle, drain } = await projectSetup();
    handle({ v: PROTOCOL_VERSION, id: "1", type: "openProject", projectId: "thesis", root: "writing/thesis" });
    await drain();
    expect(sent).toMatchObject([{ type: "error", id: "1", code: "no-library" }]);
  });

  it("refuses an edit of a project that is not open with project-id", async () => {
    const { sent, handle, drain } = await projectSetup(await tempDir());
    handle({ v: PROTOCOL_VERSION, id: "1", type: "edit", projectId: "thesis", path: "main.tex", version: 1, text: "x" });
    await drain();
    expect(sent).toMatchObject([{ type: "error", id: "1", code: "project-id" }]);
  });

  it("opens, edits and closes a project of the library", async () => {
    const library = await tempDir();
    await fs.mkdir(path.join(library, "writing/thesis"), { recursive: true });
    await fs.writeFile(path.join(library, "writing/thesis/main.tex"), "disk");
    const { sent, handle, drain, projects, dataDir, forgotten } = await projectSetup(library);
    const stale = path.join(dataDir, "projects/thesis/src/gone.tex");
    await fs.mkdir(path.dirname(stale), { recursive: true });
    await fs.writeFile(stale, "old");

    handle({ v: PROTOCOL_VERSION, id: "1", type: "openProject", projectId: "thesis", root: "writing/thesis" });
    handle({ v: PROTOCOL_VERSION, id: "2", type: "edit", projectId: "thesis", path: "main.tex", version: 1, text: "unsaved" });
    await drain();
    expect(sent).toEqual([{ v: PROTOCOL_VERSION, id: "1", type: "opened", projectId: "thesis", files: ["main.tex"] }]);
    await expect(projects.textOf("thesis", "main.tex")).resolves.toBe("unsaved");
    await expect(fs.stat(stale)).rejects.toThrow();

    handle({ v: PROTOCOL_VERSION, id: "3", type: "closeProject", projectId: "thesis" });
    await drain();
    expect(sent[1]).toEqual({ v: PROTOCOL_VERSION, id: "3", type: "closed", projectId: "thesis" });
    expect(() => projects.textOf("thesis", "main.tex")).toThrow(expect.objectContaining({ code: "project-id" }));
    expect(forgotten).toEqual(["thesis", "thesis"]);
  });
});

const loopLogger = { log: async () => undefined, error: async () => undefined, redact: () => undefined } as unknown as HelperLogger;
const hello = (id: string, origin = "chrome-extension://abcdefghijklmnop") => encodeFrame({ v: PROTOCOL_VERSION, id, type: "hello", extensionVersion: "0.2.0", origin });

async function run(inputChunks: Buffer[], onVersionRejected?: () => void): Promise<Array<Record<string, unknown>>> {
  const input = new PassThrough();
  const written: Buffer[] = [];
  const send = createFrameWriter({ write: (chunk: Buffer) => written.push(chunk) }, loopLogger);
  const sockets: HelperServer[] = [];
  const dispatcher = createHelperAnswerer({}, loopLogger);
  const answer: HelloAnswer = async (message, reply) => {
    const socket = await answerHello(message, reply, {
      helperVersion: "0.1.0", host: "vscode", texStatus: async () => ({ source: "none", complete: false }), logger: loopLogger, handle: dispatcher.handle,
    });
    if (socket) { sockets.push(socket); }
    return socket !== undefined;
  };
  const done = runHelperLoop(input, answer, send, loopLogger, onVersionRejected);
  for (const chunk of inputChunks) { input.write(chunk); }
  input.end();
  await done;
  await Promise.all(sockets.map((socket) => socket.close()));
  return decodeFrames(Buffer.concat(written)) as Array<Record<string, unknown>>;
}

describe("runHelperLoop", () => {
  it("answers hello with ready, then session with the socket's port and token", async () => {
    const frames = await run([hello("1")]);
    expect(frames[0]).toEqual({ v: PROTOCOL_VERSION, id: "1", type: "ready", protocol: PROTOCOL_VERSION, helperVersion: "0.1.0", host: "vscode", tex: { source: "none", complete: false } });
    expect(frames[1]).toMatchObject({ v: PROTOCOL_VERSION, id: "1", type: "session" });
    expect(typeof frames[1]!.port).toBe("number");
    expect(frames[1]!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("refuses an origin that is not an extension page", async () => {
    const frames = await run([hello("1", "https://example.com")]);
    expect(frames).toMatchObject([{ id: "1", type: "error", code: "invalid-field" }]);
  });

  it("refuses a second hello and any other native message with unknown-type", async () => {
    const other = encodeFrame({ v: PROTOCOL_VERSION, id: "3", type: "cancel", projectId: "p" });
    const frames = await run([Buffer.concat([hello("1"), hello("2"), other])]);
    expect(frames.map((f) => f.type)).toEqual(["ready", "session", "error", "error"]);
    expect(frames.slice(2)).toMatchObject([{ id: "2", code: "unknown-type" }, { id: "3", code: "unknown-type" }]);
  });

  it("survives bad JSON before the hello", async () => {
    const frames = await run([Buffer.concat([encodeFrame("{bad"), hello("2")])]);
    expect(frames.map((f) => f.type)).toEqual(["error", "ready", "session"]);
  });

  it("answers a hello of another protocol version with a version error and reports it once", async () => {
    const onVersionRejected = jest.fn();
    const stale = encodeFrame({ v: PROTOCOL_VERSION - 1, id: "1", type: "hello", extensionVersion: "0.2.0", origin: "chrome-extension://abcdefghijklmnop" });
    const frames = await run([stale, hello("2")], onVersionRejected);
    expect(frames.map((f) => f.type)).toEqual(["error", "ready", "session"]);
    expect(frames[0]).toMatchObject({ id: "1", code: "version" });
    expect(onVersionRejected).toHaveBeenCalledTimes(1);
  });
});

describe("publication replies", () => {
  it("delivers thumbnail payloads before the waiting publication finishes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let received: Uint8Array | undefined;
    const logger = { log: async () => {}, error: async () => {} };
    const dispatcher = createHelperAnswerer({
      publishTemplate: async () => { await gate; },
      templateThumbnail: async (_message, _send, payload) => { received = payload; release(); },
    }, logger);
    const png = new Uint8Array([137, 80, 78, 71]);
    dispatcher.handle({ v: PROTOCOL_VERSION, id: "publication", type: "publishTemplate", projectId: "paper", action: "open" }, new Uint8Array(), () => {});
    dispatcher.handle({ v: PROTOCOL_VERSION, id: "thumbnail", type: "templateThumbnail", requestId: "publication" }, png, () => {});
    try { expect(received).toEqual(png); }
    finally { release(); await dispatcher.drain(); }
  });
});
