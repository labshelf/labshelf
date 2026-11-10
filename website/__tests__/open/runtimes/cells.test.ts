// Pins the browser cell port: results read like the desktop drivers', unsupported languages refuse, a cancel kills the session and the next run says restarted.
import type { CellRequest } from "@labshelf/core";

import { deriveRParamCode, toCellResult } from "../../../src/open/runtimes/cellResult";
import { createCellPort, type CellSession } from "../../../src/open/runtimes/cells";

interface FakeSession extends CellSession { language: string; disposed: boolean; release(): void }

function fakeSessions() {
  const opened: FakeSession[] = [];
  const open = (language: "python" | "r"): CellSession => {
    let release = (): void => undefined;
    const session: FakeSession = {
      language,
      disposed: false,
      release: () => release(),
      run: (request: CellRequest) => request.code === "hang"
        ? new Promise((resolve) => { release = () => resolve({ printed: "late" }); })
        : request.code === "crash" ? Promise.reject(new Error("worker died")) : Promise.resolve({ printed: "hi", text: request.code }),
      dispose() { session.disposed = true; },
    };
    opened.push(session);
    return session;
  };
  return { opened, open };
}

const request = (code: string, language: CellRequest["language"] = "python", noteKey = "note-a"): CellRequest => ({ code, language, noteKey });
const signal = (): AbortSignal => new AbortController().signal;

describe("toCellResult", () => {
  it("joins printed text before the value, as the desktop drivers do", () => {
    expect(toCellResult({ printed: "1", text: "2" }, "python", 5, false)).toEqual({ status: "ok", language: "python", text: "1\n2", durationMs: 5 });
  });
  it("keeps a lone PNG as the whole text, so the note shows it as a plot", () => {
    expect(toCellResult({ printed: "", text: "data:image/png;base64,AAAA" }, "python", 1, false).text).toBe("data:image/png;base64,AAAA");
  });
  it("reports a SymPy value as latex and an error with what was printed", () => {
    expect(toCellResult({ printed: "", latex: "x^{2}" }, "python", 1, false)).toEqual({ status: "ok", language: "python", latex: "x^{2}", durationMs: 1 });
    expect(toCellResult({ printed: "before", error: "NameError: x" }, "r", 1, true)).toEqual({ status: "error", language: "r", error: "NameError: x", text: "before", durationMs: 1, restarted: true });
  });
});

describe("deriveRParamCode", () => {
  it("sets params as R literals", () => {
    expect(deriveRParamCode({ n: 3, on: true, label: 'a "b"\n' })).toBe('n <- 3\non <- TRUE\nlabel <- "a \\"b\\"\\n"\n');
  });
});

describe("createCellPort", () => {
  it("answers other languages with the run-on-your-computer error", async () => {
    const { open, opened } = fakeSessions();
    const result = await createCellPort(open).run(request("x", "mathematica"), signal());
    expect(result).toEqual({ status: "error", language: "mathematica", error: "Mathematica cells run only on your computer.", durationMs: 0 });
    expect(opened).toHaveLength(0);
  });

  it("refuses an invalid param name without starting a runtime", async () => {
    const { open, opened } = fakeSessions();
    const result = await createCellPort(open).run({ ...request("x"), params: { "bad name": 1 } }, signal());
    expect(result).toMatchObject({ status: "error", error: "Invalid parameter name bad name" });
    expect(opened).toHaveLength(0);
  });

  it("keeps one session per note and language", async () => {
    const { open, opened } = fakeSessions();
    const port = createCellPort(open);
    await port.run(request("a"), signal());
    await port.run(request("b"), signal());
    await port.run(request("c", "r"), signal());
    await port.run(request("d", "python", "note-b"), signal());
    expect(opened.map((session) => session.language)).toEqual(["python", "r", "python"]);
  });

  it("cancels a run, kills its session and marks the next result restarted", async () => {
    const { open, opened } = fakeSessions();
    const port = createCellPort(open);
    const controller = new AbortController();
    const running = port.run(request("hang"), controller.signal);
    await Promise.resolve();
    controller.abort();
    expect(await running).toMatchObject({ status: "cancelled", language: "python" });
    expect(opened[0]!.disposed).toBe(true);
    const next = await port.run(request("x"), signal());
    expect(next).toMatchObject({ status: "ok", text: "hi\nx", restarted: true });
    expect(opened).toHaveLength(2);
    expect((await port.run(request("y"), signal())).restarted).toBeUndefined();
  });

  it("answers a runtime failure as an error and starts fresh next time", async () => {
    const { open, opened } = fakeSessions();
    const port = createCellPort(open);
    expect(await port.run(request("crash"), signal())).toMatchObject({ status: "error", error: "worker died" });
    expect(await port.run(request("x"), signal())).toMatchObject({ status: "ok", restarted: true });
    expect(opened).toHaveLength(2);
  });

  it("runs one cell at a time per session and drops a queued run that was cancelled", async () => {
    const { open, opened } = fakeSessions();
    const port = createCellPort(open);
    const first = port.run(request("hang"), signal());
    const controller = new AbortController();
    const queued = port.run(request("x"), controller.signal);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    opened[0]!.release();
    expect(await first).toMatchObject({ status: "ok", text: "late" });
    expect(await queued).toMatchObject({ status: "cancelled" });
  });

  it("restart drops the session without marking the next run restarted", async () => {
    const { open, opened } = fakeSessions();
    const port = createCellPort(open);
    await port.run(request("a"), signal());
    port.restart("note-a", "python");
    expect(opened[0]!.disposed).toBe(true);
    expect((await port.run(request("b"), signal())).restarted).toBeUndefined();
    port.dispose();
    expect(opened[1]!.disposed).toBe(true);
  });
});
