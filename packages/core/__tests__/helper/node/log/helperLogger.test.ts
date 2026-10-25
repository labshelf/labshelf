import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { createHelperLogger } from "../../../../src/helper/node/log/index.js";

const posix = process.platform === "win32" ? it.skip : it;

describe("createHelperLogger", () => {
  let dataDir: string;
  beforeEach(async () => { dataDir = path.join(await mkdtemp(path.join(os.tmpdir(), "helper-log-")), "data"); });
  afterEach(async () => { await rm(path.dirname(dataDir), { recursive: true, force: true }); });
  const logFile = () => path.join(dataDir, "logs", "helper.log");

  it("writes entries to <data dir>/logs/helper.log", async () => {
    await createHelperLogger(dataDir).log("INFO", "helper", "started", { pid: 1 });
    expect(await readFile(logFile(), "utf8")).toContain("started");
  });

  posix("creates the data folder and logs/ as 0o700 and the log as 0o600", async () => {
    await createHelperLogger(dataDir).log("INFO", "helper", "started");
    expect((await stat(dataDir)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(dataDir, "logs"))).mode & 0o777).toBe(0o700);
    expect((await stat(logFile())).mode & 0o777).toBe(0o600);
  });

  it("redacts a registered secret, bearer tokens, key parameters and URL fragments in every field", async () => {
    const logger = createHelperLogger(dataDir);
    logger.redact("sock3t-token");
    await logger.log("INFO", "helper", "token sock3t-token; Bearer x", { url: "https://a/b?key=abc", page: "https://a/b#frag" });
    await logger.error("helper", new Error("failed with sock3t-token"));
    const text = await readFile(logFile(), "utf8");
    for (const leaked of ["sock3t-token", "Bearer x", "key=abc", "#frag"]) { expect(text).not.toContain(leaked); }
    expect(text).toContain("[redacted]");
  });
});
