// Pins that the helper host runs the version-rejection hook once and waits for it before it resolves.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { runHelperHost } from "../../../src/helper/node/runHelperHost.js";
import { PROTOCOL_VERSION } from "../../../src/helper/index.js";
import { encodeFrame } from "./helperConnectionHarness.js";

const logger = { log: async () => undefined, error: async () => undefined, redact: () => undefined } as never;

describe("runHelperHost", () => {
  let dataDir: string;
  beforeEach(async () => { dataDir = await mkdtemp(join(tmpdir(), "labshelf-host-")); });
  afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

  it("waits for afterVersionRejected after a hello of another protocol version", async () => {
    const input = new PassThrough();
    const events: string[] = [];
    const done = runHelperHost({
      dataDir, logger, helperVersion: "0.2.0", host: "helper", args: [], typstWasm: async () => new Uint8Array(), input,
      output: new PassThrough(),
      afterVersionRejected: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); events.push("update checked"); },
    }).then(() => events.push("host exited"));
    input.write(encodeFrame({ v: PROTOCOL_VERSION + 1, id: "1", type: "hello", extensionVersion: "9", origin: "chrome-extension://abc" }));
    input.end();
    await done;
    expect(events).toEqual(["update checked", "host exited"]);
  });
});
