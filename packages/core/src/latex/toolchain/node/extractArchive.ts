// Unpacks a .tar.gz or .zip archive with the system tar.
import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

function tarProgram(): string {
  // PLATFORM: on Windows a GNU tar earlier on PATH (Git for Windows) cannot read .zip; the system bsdtar can.
  const systemRoot = process.env["SystemRoot"];
  return process.platform === "win32" && systemRoot ? path.join(systemRoot, "System32", "tar.exe") : "tar";
}

export async function extractArchive(
  archive: string,
  kind: "tar.gz" | "zip",
  destination: string,
  signal?: AbortSignal,
): Promise<void> {
  await run(tarProgram(), [kind === "tar.gz" ? "-xzf" : "-xf", archive, "-C", destination], signal ? { signal } : {});
}
