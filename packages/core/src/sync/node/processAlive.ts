/** Process-liveness check the sync lock uses to take over a lock left by a dead process. */

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
