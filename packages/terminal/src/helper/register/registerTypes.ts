// Declares the ports and options that registration needs from the composition root.
import type { ILogger } from "@labshelf/core";

export interface RegResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RegisterDeps {
  platform: NodeJS.Platform;
  homeDir: string;
  env: NodeJS.ProcessEnv;
  /** The helper data folder; on Windows it holds the manifest files the registry keys point at. */
  dataDir: string;
  /** Absolute path of the installed helper executable. */
  binaryPath: string;
  logger: ILogger;
  /** Runs `reg.exe` with the given arguments; used on win32 only. */
  runReg: (args: string[]) => Promise<RegResult>;
}
