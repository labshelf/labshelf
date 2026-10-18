// Runs the Windows `reg` tool for the native-host installer.
import { execFile } from "node:child_process";

import type { RegistryRunner } from "../nativeHostEnv.js";

export const systemRegistry: RegistryRunner = (args) =>
  new Promise((resolve) => {
    execFile("reg", [...args], { windowsHide: true }, (error, stdout, stderr) => {
      const code = (error as { code?: unknown } | null)?.code;
      // A failed spawn has a string code such as ENOENT; the installer reads that as a failed command.
      resolve({ exitCode: error ? (typeof code === "number" ? code : 1) : 0, stdout, stderr: stderr || (error && typeof code !== "number" ? error.message : "") });
    });
  });
