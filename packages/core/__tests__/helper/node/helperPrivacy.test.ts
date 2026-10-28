// Pins the helper's privacy: the start-time refusal of paths other users can change, the redaction of secrets and the private file logger.
import { promises as fs } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  assertHelperPrivatePaths, assertPrivatePaths, createHelperLogger, removeSecretsFromJson, removeSecretsFromText,
} from "../../../src/helper/node/helperPrivacy";
import { cleanupTempDirs, makeTempDir } from "../../support/tempDirs";

afterEach(() => { jest.restoreAllMocks(); return cleanupTempDirs(); });

const posixDescribe = process.platform === "win32" ? describe.skip : describe;
const posixIt = process.platform === "win32" ? it.skip : it;

async function pathsLayout(dirMode: number, binaryMode: number) {
  const root = await makeTempDir();
  const dataDir = path.join(root, "data");
  const binaryPath = path.join(root, "labshelf-helper");
  await fs.mkdir(dataDir);
  await fs.writeFile(binaryPath, "binary");
  await fs.chmod(dataDir, dirMode);
  await fs.chmod(binaryPath, binaryMode);
  return { dataDir, binaryPath };
}

posixDescribe("assertPrivatePaths", () => {
  it("accepts a 0o700 data folder and a 0o755 binary", async () => {
    const { dataDir, binaryPath } = await pathsLayout(0o700, 0o755);
    await expect(assertPrivatePaths([dataDir, binaryPath])).resolves.toBeUndefined();
  });

  it("refuses a 0o775 data folder and names its path and mode", async () => {
    const { dataDir, binaryPath } = await pathsLayout(0o775, 0o755);
    await expect(assertPrivatePaths([dataDir, binaryPath])).rejects.toThrow(`${dataDir} (mode 775)`);
  });

  it("leaves the mode of the folder it refuses unchanged", async () => {
    const { dataDir, binaryPath } = await pathsLayout(0o775, 0o755);
    await assertPrivatePaths([dataDir, binaryPath]).catch(() => undefined);
    expect((await fs.stat(dataDir)).mode & 0o777).toBe(0o775);
  });

  it("refuses a 0o777 binary", async () => {
    const { dataDir, binaryPath } = await pathsLayout(0o700, 0o777);
    await expect(assertPrivatePaths([dataDir, binaryPath])).rejects.toThrow(binaryPath);
  });

  it("skips a path that does not exist yet", async () => {
    const { binaryPath } = await pathsLayout(0o700, 0o755);
    await expect(assertPrivatePaths([path.join(path.dirname(binaryPath), "absent"), binaryPath])).resolves.toBeUndefined();
  });
});

async function helperLayout(binDirMode: number) {
  const root = await makeTempDir();
  const dataDir = path.join(root, "data");
  const binaryDir = path.join(root, "bin");
  const binaryPath = path.join(binaryDir, "labshelf-helper");
  await fs.mkdir(dataDir);
  await fs.mkdir(binaryDir);
  await fs.writeFile(binaryPath, "binary");
  await fs.chmod(dataDir, 0o700);
  await fs.chmod(binaryDir, binDirMode);
  return { dataDir, binaryDir, binaryPath };
}

posixDescribe("assertHelperPrivatePaths", () => {
  it("accepts a private layout", async () => {
    const { dataDir, binaryPath } = await helperLayout(0o755);
    await expect(assertHelperPrivatePaths({ binaryPath, dataDir })).resolves.toBeUndefined();
  });

  it("refuses a binary folder that other users can write to", async () => {
    const { dataDir, binaryPath, binaryDir } = await helperLayout(0o775);
    await expect(assertHelperPrivatePaths({ binaryPath, dataDir })).rejects.toThrow(`${binaryDir} (mode 775)`);
  });

  it("accepts a group-writable binary folder owned by root", async () => {
    const { dataDir, binaryPath, binaryDir } = await helperLayout(0o775);
    const stat = fs.stat.bind(fs);
    jest.spyOn(fs, "stat").mockImplementation(async (target, ...rest) => {
      const real = await (stat as (...args: unknown[]) => Promise<import("node:fs").Stats>)(target, ...rest);
      return target === binaryDir ? Object.assign(Object.create(real), { uid: 0, mode: real.mode }) : real;
    });
    await expect(assertHelperPrivatePaths({ binaryPath, dataDir })).resolves.toBeUndefined();
  });

  it("refuses a bin folder inside the data folder that other users can write to", async () => {
    const { dataDir, binaryPath } = await helperLayout(0o755);
    const bin = path.join(dataDir, "bin");
    await fs.mkdir(bin);
    await fs.chmod(bin, 0o777);
    await expect(assertHelperPrivatePaths({ binaryPath, dataDir })).rejects.toThrow(`${bin} (mode 777)`);
  });
});

describe("removeSecretsFromText", () => {
  it("hides registered secrets", () => {
    expect(removeSecretsFromText("token abc123 sent", ["abc123"])).toBe("token [redacted] sent");
  });

  it("hides bearer tokens", () => {
    expect(removeSecretsFromText("Authorization: Bearer x.y-z", [])).toBe("Authorization: Bearer [redacted]");
  });

  it("hides key query parameters", () => {
    expect(removeSecretsFromText("GET https://a/b?x=1&key=abc&y=2", [])).toBe("GET https://a/b?x=1&key=[redacted]&y=2");
    expect(removeSecretsFromText("https://a/b?key=abc", [])).toBe("https://a/b?key=[redacted]");
  });

  it("hides URL fragments", () => {
    expect(removeSecretsFromText("open https://a/b#frag now", [])).toBe("open https://a/b#[redacted] now");
  });
});

describe("removeSecretsFromJson", () => {
  it("reaches strings nested in objects and arrays", () => {
    expect(removeSecretsFromJson({ a: ["Bearer q", { b: "s3" }], n: 1 }, ["s3"])).toEqual({ a: ["Bearer [redacted]", { b: "[redacted]" }], n: 1 });
  });
});

describe("createHelperLogger", () => {
  let dataDir: string;
  beforeEach(async () => { dataDir = path.join(await mkdtemp(path.join(os.tmpdir(), "helper-log-")), "data"); });
  afterEach(async () => { await rm(path.dirname(dataDir), { recursive: true, force: true }); });
  const logFile = () => path.join(dataDir, "logs", "helper.log");

  it("writes entries to <data dir>/logs/helper.log", async () => {
    await createHelperLogger(dataDir).log("INFO", "helper", "started", { pid: 1 });
    expect(await readFile(logFile(), "utf8")).toContain("started");
  });

  posixIt("creates the data folder and logs/ as 0o700 and the log as 0o600", async () => {
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
