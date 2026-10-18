import { mkdir, mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { ILogger } from "@labshelf/core";

import type { RegisterDeps, RegResult } from "../../../src/helper/register/index.js";

export interface RegisterFixture {
  root: string;
  deps: RegisterDeps;
  regCalls: string[][];
  logs: string[];
  cleanup(): Promise<void>;
}

/** `reg` answers `query` with `queryCode`; every other call succeeds. */
export async function createFixture(
  platform: NodeJS.Platform,
  options: { env?: NodeJS.ProcessEnv; queryCode?: number; failAdd?: boolean } = {},
): Promise<RegisterFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "helper-register-"));
  const homeDir = path.join(root, "home");
  await mkdir(homeDir, { recursive: true });
  const regCalls: string[][] = [];
  const logs: string[] = [];
  const logger: ILogger = {
    log: async (_level, _module, message) => { logs.push(message); },
    error: async (_module, error) => { logs.push(String(error)); },
  };
  const runReg = async (args: string[]): Promise<RegResult> => {
    regCalls.push(args);
    if (args[0] === "query") { return { code: options.queryCode ?? 0, stdout: "", stderr: "" }; }
    if (args[0] === "add" && options.failAdd) { return { code: 1, stdout: "", stderr: "denied" }; }
    return { code: 0, stdout: "", stderr: "" };
  };
  const deps: RegisterDeps = {
    platform, homeDir, env: options.env ?? {}, dataDir: path.join(root, "data"),
    binaryPath: platform === "win32" ? "C:\\Program Files\\LabShelf\\labshelf-helper.exe" : "/opt/labshelf/labshelf-helper",
    logger, runReg,
  };
  return { root, deps, regCalls, logs, cleanup: () => rm(root, { recursive: true, force: true }) };
}
