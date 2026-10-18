// Pins how followBuilds mirrors helper project build events onto a preview frame.
import type { ILogger } from "@labshelf/core";
import { followBuilds, type PreviewBuildEvent, type PreviewBuildSource } from "../../../src/library-page/preview";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

function setup() {
  let listener: ((event: PreviewBuildEvent) => void) | undefined;
  const source: PreviewBuildSource = {
    build: jest.fn(async () => undefined),
    onBuild: (l) => { listener = l; return () => { listener = undefined; }; },
  };
  const frame = { showPdf: jest.fn(), setBuildStatus: jest.fn() };
  return { source, frame, send: (event: PreviewBuildEvent) => listener?.(event), isListening: () => listener !== undefined };
}

describe("followBuilds", () => {
  it("shows the bytes of each pdf event and sets the status from the result", () => {
    const { source, frame, send } = setup();
    followBuilds(source, frame, "a", logger);
    const bytes = new Uint8Array([1, 2, 3]);
    send({ type: "building" });
    send({ type: "pdf", bytes, mode: "preview" });
    send({ type: "result", result: { status: "succeeded", problems: [], changed: [] } });
    expect(source.build).toHaveBeenCalledWith("a");
    expect(frame.showPdf).toHaveBeenCalledWith(bytes);
    expect(frame.setBuildStatus.mock.calls.map(([status]) => status.state)).toEqual(["building", "succeeded"]);
  });

  it("stops following when disposed", () => {
    const { source, frame, isListening } = setup();
    followBuilds(source, frame, "a", logger).dispose();
    expect(isListening()).toBe(false);
  });
});
