// Declares what the helper needs from the managed Tinymist and from a spawned language server process.
import type { ChildProcessWithoutNullStreams } from "node:child_process";

/** The managed Tinymist (documents/contracts/managed-tools.md#tinymist) as the helper uses it. */
export interface ManagedTinymist {
  /** The binary's path when one is installed, without installing. */
  resolve(): Promise<string | undefined>;
  /** Installs Tinymist when it is missing and returns the binary's path; `onProgress` gets a message and, when known, the fraction done. */
  ensure(onProgress?: (progress: { message: string; fraction?: number }) => void): Promise<string>;
}

export type LspChild = Pick<ChildProcessWithoutNullStreams, "stdin" | "stdout" | "stderr" | "kill" | "on">;

export type SpawnLsp = (command: string, args: readonly string[], options: { cwd: string; env: Record<string, string> }) => LspChild;
