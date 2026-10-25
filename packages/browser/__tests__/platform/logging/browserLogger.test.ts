// Each entry reaches the console method of its level under a `[labshelf:<module>]` prefix.
import type { LogEntry } from "@labshelf/core";
import { ConsoleLogSink } from "../../../src/platform/logging/browserLogger";

const entry = (level: LogEntry["level"]): LogEntry => ({ timestamp: "t", level, module: "capture", message: "msg", context: { a: 1 } });

describe("ConsoleLogSink", () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([["ERROR", "error"], ["WARN", "warn"], ["INFO", "info"]] as const)("writes %s through console.%s", async (level, method) => {
    const spy = jest.spyOn(console, method).mockImplementation(() => undefined);
    await new ConsoleLogSink().append(entry(level));
    expect(spy).toHaveBeenCalledWith("[labshelf:capture]", "msg", { a: 1 });
  });
});
