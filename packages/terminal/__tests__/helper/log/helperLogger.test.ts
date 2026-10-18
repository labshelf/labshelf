import { mkdtemp, readFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { createHelperLogger } from "../../../src/helper/log/index.js";

describe("createHelperLogger", () => {
  it("writes entries to <data dir>/logs/helper.log", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "helper-log-"));
    try {
      await createHelperLogger(dataDir).log("INFO", "helper", "started", { pid: 1 });
      const text = await readFile(path.join(dataDir, "logs", "helper.log"), "utf8");
      expect(text).toContain("started");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
