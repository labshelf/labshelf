// Pins the helper's linked-output source messages: their parsers (absolute folder, confined path, command, replies), the capability,
// and the handlers over a temp folder: inspect with the git remote, list, read with confinement and the missing answer, run and cancel.
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ILogger } from "../../../src/ports/index.js";
import { LINKED_OUTPUTS_CAPABILITY, PROTOCOL_VERSION, type ToHelperMessage, type ToPageMessage } from "../../../src/helper/helperMessages.js";
import { parseHelperMessage } from "../../../src/helper/parseHelperMessage.js";
import { helperCanLinkOutputs } from "../../../src/helper/helperPaths.js";
import { HELPER_CAPABILITIES } from "../../../src/helper/node/helperHandlers.js";
import { createSourceHandlers } from "../../../src/helper/node/sourceHandlers.js";

const ENV = (id: string) => ({ v: PROTOCOL_VERSION, id });
const logger: ILogger = { log: async () => undefined, error: async () => undefined };
const code = (raw: unknown, direction: "toHelper" | "toPage") => {
  const result = parseHelperMessage(raw, direction);
  return result.ok ? "ok" : result.code;
};

describe("source message parsing", () => {
  it("accepts an absolute POSIX or Windows folder and refuses relative or dotted ones", () => {
    expect(code({ ...ENV("1"), type: "sourceList", folder: "/home/ana/experiments" }, "toHelper")).toBe("ok");
    expect(code({ ...ENV("1"), type: "sourceList", folder: "C:\\Users\\ana\\exp" }, "toHelper")).toBe("ok");
    expect(code({ ...ENV("1"), type: "sourceList", folder: "experiments" }, "toHelper")).toBe("path");
    expect(code({ ...ENV("1"), type: "sourceList", folder: "/home/ana/../bob" }, "toHelper")).toBe("path");
    expect(code({ ...ENV("1"), type: "sourceInspect", folder: "" }, "toHelper")).toBe("path");
  });

  it("confines the read path and caps the command and the timeout", () => {
    expect(code({ ...ENV("1"), type: "sourceRead", folder: "/r", path: "results/fig.pdf" }, "toHelper")).toBe("ok");
    expect(code({ ...ENV("1"), type: "sourceRead", folder: "/r", path: "../etc/passwd" }, "toHelper")).toBe("path");
    expect(code({ ...ENV("1"), type: "sourceRead", folder: "/r", path: "/etc/passwd" }, "toHelper")).toBe("path");
    expect(code({ ...ENV("1"), type: "sourceRun", folder: "/r", command: "make", timeoutMs: 1000 }, "toHelper")).toBe("ok");
    expect(code({ ...ENV("1"), type: "sourceRun", folder: "/r", command: "  ", timeoutMs: 1000 }, "toHelper")).toBe("invalid-field");
    expect(code({ ...ENV("1"), type: "sourceRun", folder: "/r", command: "x".repeat(9000), timeoutMs: 1000 }, "toHelper")).toBe("limit");
    expect(code({ ...ENV("1"), type: "sourceRun", folder: "/r", command: "make", timeoutMs: 0 }, "toHelper")).toBe("invalid-field");
    expect(code({ ...ENV("1"), type: "cancelSourceRun", requestId: "7" }, "toHelper")).toBe("ok");
    expect(code({ ...ENV("1"), type: "sourcePick" }, "toHelper")).toBe("ok");
  });

  it("reads the replies a page receives", () => {
    expect(parseHelperMessage({ ...ENV("1"), type: "sourcePicked", unavailable: true }, "toPage")).toEqual({ ok: true, message: { ...ENV("1"), type: "sourcePicked", unavailable: true } });
    expect(code({ ...ENV("1"), type: "sourcePicked", folder: "relative" }, "toPage")).toBe("path");
    expect(parseHelperMessage({ ...ENV("1"), type: "sourceInfo", exists: true, remote: "git@github.com:a/b.git" }, "toPage")).toEqual({ ok: true, message: { ...ENV("1"), type: "sourceInfo", exists: true, remote: "git@github.com:a/b.git" } });
    expect(code({ ...ENV("1"), type: "sourceFiles", files: ["a.csv", "../b"] }, "toPage")).toBe("path");
    expect(code({ ...ENV("1"), type: "sourceBytes", bytes: 3, missing: false }, "toPage")).toBe("ok");
    expect(parseHelperMessage({ ...ENV("1"), type: "sourceRan", status: "finished", code: null, output: "x" }, "toPage")).toEqual({ ok: true, message: { ...ENV("1"), type: "sourceRan", status: "finished", code: null, output: "x" } });
    expect(code({ ...ENV("1"), type: "sourceRan", status: "declined" }, "toPage")).toBe("invalid-field");
  });

  it("announces linkedOutputs in every ready", () => {
    expect(HELPER_CAPABILITIES).toContain(LINKED_OUTPUTS_CAPABILITY);
    expect(helperCanLinkOutputs({ state: "ready", helperVersion: "1", host: "helper", tex: { source: "none", complete: false }, capabilities: [LINKED_OUTPUTS_CAPABILITY] })).toBe(true);
    expect(helperCanLinkOutputs({ state: "ready", helperVersion: "1", host: "helper", tex: { source: "none", complete: false } })).toBe(false);
  });
});

describe("source handlers", () => {
  let root: string;
  let outside: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "ls-source-"));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "ls-outside-"));
    await fs.mkdir(path.join(root, "results"));
    await fs.mkdir(path.join(root, ".git"));
    await fs.writeFile(path.join(root, ".git", "config"), '[remote "origin"]\n\turl = https://github.com/ana/experiments.git\n');
    await fs.writeFile(path.join(root, "results", "table.csv"), "a,b\n1,2\n");
    await fs.writeFile(path.join(outside, "secret.txt"), "no");
    await fs.symlink(path.join(outside, "secret.txt"), path.join(root, "results", "leak.txt"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  const call = async (handlers: ReturnType<typeof createSourceHandlers>, message: ToHelperMessage) => {
    const sent: Array<{ message: ToPageMessage; payload?: Uint8Array }> = [];
    await handlers[message.type as keyof typeof handlers]!(message, (reply, payload) => { sent.push({ message: reply, ...(payload ? { payload } : {}) }); });
    return sent;
  };

  it("inspects a folder and its remote, and a missing folder", async () => {
    const handlers = createSourceHandlers({ logger });
    expect((await call(handlers, { ...ENV("1"), type: "sourceInspect", folder: root }))[0]!.message).toEqual({ ...ENV("1"), type: "sourceInfo", exists: true, remote: "https://github.com/ana/experiments.git" });
    expect((await call(handlers, { ...ENV("2"), type: "sourceInspect", folder: path.join(root, "nope") }))[0]!.message).toEqual({ ...ENV("2"), type: "sourceInfo", exists: false });
  });

  it("lists the files without hidden folders or links", async () => {
    const [reply] = await call(createSourceHandlers({ logger }), { ...ENV("1"), type: "sourceList", folder: root });
    expect(reply!.message).toEqual({ ...ENV("1"), type: "sourceFiles", files: ["results/table.csv"] });
  });

  it("reads a file as payload, answers missing, and refuses a link out of the folder", async () => {
    const handlers = createSourceHandlers({ logger });
    const [read] = await call(handlers, { ...ENV("1"), type: "sourceRead", folder: root, path: "results/table.csv" });
    expect(read!.message).toEqual({ ...ENV("1"), type: "sourceBytes", bytes: 8 });
    expect(new TextDecoder().decode(read!.payload)).toBe("a,b\n1,2\n");
    expect((await call(handlers, { ...ENV("2"), type: "sourceRead", folder: root, path: "results/none.csv" }))[0]!.message).toEqual({ ...ENV("2"), type: "sourceBytes", bytes: 0, missing: true });
    expect((await call(handlers, { ...ENV("3"), type: "sourceRead", folder: root, path: "results/leak.txt" }))[0]!.message).toMatchObject({ type: "error", code: "path" });
    expect((await call(handlers, { ...ENV("4"), type: "sourceList", folder: path.join(root, "nope") }))[0]!.message).toMatchObject({ type: "error", code: "path" });
  });

  it("answers the pick, or unavailable when there is no dialog", async () => {
    expect((await call(createSourceHandlers({ logger, pickFolder: async () => root }), { ...ENV("1"), type: "sourcePick" }))[0]!.message).toEqual({ ...ENV("1"), type: "sourcePicked", folder: root });
    expect((await call(createSourceHandlers({ logger, pickFolder: async () => { throw new Error("no folder dialog"); } }), { ...ENV("2"), type: "sourcePick" }))[0]!.message).toEqual({ ...ENV("2"), type: "sourcePicked", unavailable: true });
  });

  it("runs the command in the folder and cancels a run by its request id", async () => {
    const handlers = createSourceHandlers({ logger });
    const [ran] = await call(handlers, { ...ENV("1"), type: "sourceRun", folder: root, command: "echo made > results/out.txt && echo done", timeoutMs: 20_000 });
    expect(ran!.message).toMatchObject({ type: "sourceRan", status: "finished", code: 0 });
    expect(await fs.readFile(path.join(root, "results", "out.txt"), "utf8")).toBe("made\n");
    const running = call(handlers, { ...ENV("2"), type: "sourceRun", folder: root, command: "sleep 30", timeoutMs: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await call(handlers, { ...ENV("3"), type: "cancelSourceRun", requestId: "2" });
    expect((await running)[0]!.message).toEqual({ ...ENV("2"), type: "sourceRan", status: "cancelled" });
  }, 20_000);
});
