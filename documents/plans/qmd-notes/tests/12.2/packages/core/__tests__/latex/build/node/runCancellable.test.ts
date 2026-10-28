/** Verifies runCancellable ends a stuck process: timeout, SIGTERM to the group, SIGKILL after the grace period, separable streams. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { BuildCancelled, ProcessTimedOut, runCancellable } from "../../../../src/latex/node/run";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const posixOnly = process.platform === "win32" ? describe.skip : describe;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function readPid(file: string): Promise<number> {
  for (let i = 0; i < 100; i += 1) {
    const text = await fs.readFile(file, "utf8").catch(() => "");
    if (text.trim() !== "") { return Number(text.trim()); }
    await sleep(20);
  }
  throw new Error("The child never wrote its pid");
}

async function script(body: string): Promise<{ dir: string; pidFile: string; executable: string }> {
  const dir = await makeTempDir();
  const pidFile = path.join(dir, "pid");
  const executable = path.join(dir, "child.sh");
  await fs.writeFile(executable, `#!/bin/sh\necho $$ > "${pidFile}"\n${body}\n`, { mode: 0o755 });
  return { dir, pidFile, executable };
}

const IGNORES_TERM = "trap '' TERM\nwhile :; do sleep 1; done";

posixOnly("runCancellable timeout", () => {
  it("12.2a rejects with ProcessTimedOut when the child outlives timeoutMs", async () => {
    const { dir, executable } = await script("sleep 30");
    const started = Date.now();
    const error = await runCancellable(executable, [], dir, new AbortController().signal, { timeoutMs: 200 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProcessTimedOut);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BuildCancelled);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("12.2a names the timeout in the error", () => {
    const error = new ProcessTimedOut(1500);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ProcessTimedOut");
    expect(error.message).toContain("1500");
  });

  it("12.2a leaves no sleeping child behind after the timeout", async () => {
    const { dir, pidFile, executable } = await script("sleep 30");
    await runCancellable(executable, [], dir, new AbortController().signal, { timeoutMs: 200 }).catch(() => undefined);
    const pid = await readPid(pidFile);
    await sleep(100);
    expect(alive(pid)).toBe(false);
  });

  it("12.2a kills a grandchild in the same process group", async () => {
    const { dir, executable } = await script('sleep 30 &\necho $! > "$0.grandchild"\nwait');
    await runCancellable(executable, [], dir, new AbortController().signal, { timeoutMs: 300 }).catch(() => undefined);
    const grandchild = await readPid(`${executable}.grandchild`);
    await sleep(100);
    expect(alive(grandchild)).toBe(false);
  });

  it("12.2a ends at SIGTERM, without waiting for the grace period, when the child obeys it", async () => {
    const { dir, executable } = await script("sleep 30");
    const started = Date.now();
    await runCancellable(executable, [], dir, new AbortController().signal, { timeoutMs: 200, killGraceMs: 8000 }).catch(() => undefined);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("12.2a does not time out a child that finishes in time", async () => {
    const { dir, executable } = await script("echo done");
    const result = await runCancellable(executable, [], dir, new AbortController().signal, { timeoutMs: 10_000 });
    expect(result.code).toBe(0);
    expect(result.output).toBe("done\n");
  });
});

posixOnly("runCancellable escalation", () => {
  it("12.2b keeps a child that ignores SIGTERM alive until the grace period ends, then kills it", async () => {
    const { dir, pidFile, executable } = await script(IGNORES_TERM);
    const started = Date.now();
    const pending = runCancellable(executable, [], dir, new AbortController().signal, { timeoutMs: 200, killGraceMs: 1500 });
    const settled = pending.catch((e: unknown) => e);
    const pid = await readPid(pidFile);
    await sleep(900);
    expect(alive(pid)).toBe(true);
    const error = await settled;
    expect(error).toBeInstanceOf(ProcessTimedOut);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1500);
    expect(alive(pid)).toBe(false);
  });

  it("12.2b sends SIGKILL to the whole group, so a SIGTERM-ignoring grandchild dies too", async () => {
    const { dir, pidFile, executable } = await script(`trap '' TERM\n(trap '' TERM; while :; do sleep 1; done) &\necho $! > "$0.grandchild"\nwait`);
    await runCancellable(executable, [], dir, new AbortController().signal, { timeoutMs: 200, killGraceMs: 400 }).catch(() => undefined);
    const pid = await readPid(pidFile);
    const grandchild = await readPid(`${executable}.grandchild`);
    await sleep(100);
    expect(alive(pid)).toBe(false);
    expect(alive(grandchild)).toBe(false);
  });

  it("12.2b escalates a cancel to SIGKILL after the grace period and still rejects with BuildCancelled", async () => {
    const { dir, pidFile, executable } = await script(IGNORES_TERM);
    const controller = new AbortController();
    const settled = runCancellable(executable, [], dir, controller.signal, { killGraceMs: 600 }).catch((e: unknown) => e);
    const pid = await readPid(pidFile);
    controller.abort();
    await sleep(250);
    expect(alive(pid)).toBe(true);
    const error = await settled;
    expect(error).toBeInstanceOf(BuildCancelled);
    expect(error).not.toBeInstanceOf(ProcessTimedOut);
    expect(alive(pid)).toBe(false);
  });

  it("12.2b logs the escalation through the given logger", async () => {
    const { dir, executable } = await script(IGNORES_TERM);
    const logger = fakeLogger();
    await runCancellable(executable, [], dir, new AbortController().signal, { timeoutMs: 200, killGraceMs: 300, logger }).catch(() => undefined);
    expect(logger.logs.length + logger.errors.length).toBeGreaterThan(0);
  });
});

posixOnly("runCancellable unchanged behaviour", () => {
  it("12.2c returns only code and the merged output by default", async () => {
    const { dir, executable } = await script("echo out\necho err 1>&2\nexit 3");
    const result = await runCancellable(executable, [], dir, new AbortController().signal);
    expect(result.code).toBe(3);
    expect(result.output).toContain("out");
    expect(result.output).toContain("err");
    expect(Object.keys(result).sort()).toEqual(["code", "output"]);
  });

  it("12.2c gives stdout and stderr tails apart when separateStreams is set", async () => {
    const { dir, executable } = await script("echo out\necho err 1>&2");
    const result = await runCancellable(executable, [], dir, new AbortController().signal, { separateStreams: true });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("out\n");
    expect(result.stderr).toBe("err\n");
    expect(result.output).toContain("out");
    expect(result.output).toContain("err");
  });

  it("12.2c keeps only the tail of each separated stream", async () => {
    const { dir, executable } = await script('i=0\nwhile [ $i -lt 3000 ]; do echo "line-$i-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; i=$((i+1)); done\necho end 1>&2');
    const result = await runCancellable(executable, [], dir, new AbortController().signal, { separateStreams: true });
    expect(result.stdout!.length).toBeLessThanOrEqual(64 * 1024);
    expect(result.stdout).toContain("line-2999-");
    expect(result.stdout).not.toContain("line-0-");
    expect(result.stderr).toBe("end\n");
  });

  it("12.2c still delivers each chunk to onOutput with separateStreams", async () => {
    const { dir, executable } = await script("echo out\necho err 1>&2");
    let seen = "";
    await runCancellable(executable, [], dir, new AbortController().signal, { separateStreams: true, onOutput: (chunk) => { seen += chunk; } });
    expect(seen).toContain("out");
    expect(seen).toContain("err");
  });

  it("12.2c has no timeout by default", async () => {
    const { dir, executable } = await script("sleep 1\necho late");
    const result = await runCancellable(executable, [], dir, new AbortController().signal);
    expect(result).toEqual({ code: 0, output: "late\n" });
  });

  it("12.2c rejects at once with BuildCancelled when the signal is already aborted", async () => {
    const { dir, executable } = await script("echo hi");
    const controller = new AbortController();
    controller.abort();
    await expect(runCancellable(executable, [], dir, controller.signal)).rejects.toBeInstanceOf(BuildCancelled);
  });

  it("12.2c cancels a running child with BuildCancelled and ends it", async () => {
    const { dir, pidFile, executable } = await script("sleep 30");
    const controller = new AbortController();
    const settled = runCancellable(executable, [], dir, controller.signal).catch((e: unknown) => e);
    const pid = await readPid(pidFile);
    controller.abort();
    expect(await settled).toBeInstanceOf(BuildCancelled);
    await sleep(100);
    expect(alive(pid)).toBe(false);
  });

  it("12.2c passes env and shell options through as before", async () => {
    const dir = await makeTempDir();
    const result = await runCancellable('echo "$LS_PROBE"', [], dir, new AbortController().signal, { shell: true, env: { ...process.env, LS_PROBE: "probe" } });
    expect(result).toEqual({ code: 0, output: "probe\n" });
  });
});
