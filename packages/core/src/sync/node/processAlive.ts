/** Checks whether a process is alive, so the sync lock can take over a lock left by a dead one. */

/**
 * Whether a process with this pid runs on this machine (EPERM means it exists under another user).
 * @returns true when alive
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
