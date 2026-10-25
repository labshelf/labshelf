// Pins how followBuilds mirrors helper project build events onto a preview frame.
import type { BuildOptions, ILogger } from "@labshelf/core";
import { watchBuilds, type PreviewBuildEvent, type PreviewBuildSource } from "../../../src/writing/preview";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

function setup() {
  let listener: ((event: PreviewBuildEvent) => void) | undefined;
  const source: PreviewBuildSource = {
    build: jest.fn(async () => undefined),
    onBuild: (l) => { listener = l; return () => { listener = undefined; }; },
  };
  const frame = { showPdf: jest.fn(), setBuildStatus: jest.fn(), setPreviewRoots: jest.fn() };
  return { source, frame, send: (event: PreviewBuildEvent) => listener?.(event), isListening: () => listener !== undefined };
}

describe("watchBuilds", () => {
  it("shows the bytes of each pdf event and sets the status from the result", () => {
    const { source, frame, send } = setup();
    watchBuilds(source, frame, { id: "a", main: "main.tex" }, logger);
    const bytes = new Uint8Array([1, 2, 3]);
    send({ type: "building" });
    send({ type: "pdf", bytes, mode: "preview" });
    send({ type: "result", result: { status: "succeeded", problems: [], changed: [] } });
    expect(source.build).toHaveBeenCalledWith("a");
    expect(frame.showPdf).toHaveBeenCalledWith(bytes);
    expect(frame.setBuildStatus.mock.calls.map(([status]) => status.state)).toEqual(["building", "succeeded"]);
  });

  it("posts the main root with its problems after a failed and a succeeded result", () => {
    const { source, frame, send } = setup();
    watchBuilds(source, frame, { id: "a", main: "main.tex" }, logger);
    const problem = { severity: "error" as const, message: "Undefined control sequence", file: "intro.tex", line: 3, kind: "overfull" as const };
    send({ type: "result", result: { status: "failed", problems: [problem], changed: [] } });
    send({ type: "result", result: { status: "succeeded", problems: [], changed: [] } });
    const root = (failed: boolean, problems: unknown[]) => ({
      main: "main.tex", focused: "main.tex", shown: "main.tex",
      roots: [{ path: "main.tex", failed, rawLog: false, sourceLinks: false, problems }],
    });
    expect(frame.setPreviewRoots.mock.calls).toEqual([
      [root(true, [{ severity: "error", message: "Undefined control sequence", file: "intro.tex", line: 3 }])],
      [root(false, [])],
    ]);
  });

  it("carries the project's limits and posts them again on resend", () => {
    const { source, frame, send } = setup();
    const limits: { pages?: number; words?: number } = { pages: 8 };
    const follow = watchBuilds(source, frame, { id: "a", main: "main.tex", limits: () => limits }, logger);
    send({ type: "result", result: { status: "succeeded", problems: [], changed: [] } });
    limits.words = 4000;
    follow.resendRoots();
    expect(frame.setPreviewRoots.mock.calls.map(([roots]) => [roots.pageLimit, roots.wordLimit])).toEqual([[8, undefined], [8, 4000]]);
    expect(follow.roots()?.wordLimit).toBe(4000);
  });

  it("carries the build options and posts their changes on resend", () => {
    const { source, frame, send } = setup();
    const options: BuildOptions = { autoCompile: "typing", engine: null, haltOnError: false };
    const follow = watchBuilds(source, frame, { id: "a", main: "main.tex", options: () => options }, logger);
    send({ type: "result", result: { status: "succeeded", problems: [], changed: [] } });
    options.engine = "lualatex";
    follow.resendRoots();
    expect(frame.setPreviewRoots.mock.calls.map(([roots]) => roots.options)).toEqual([
      { autoCompile: "typing", engine: null, haltOnError: false },
      { autoCompile: "typing", engine: "lualatex", haltOnError: false },
    ]);
  });

  it("stops following when disposed", () => {
    const { source, frame, isListening } = setup();
    watchBuilds(source, frame, { id: "a", main: "main.tex" }, logger).dispose();
    expect(isListening()).toBe(false);
  });
});
