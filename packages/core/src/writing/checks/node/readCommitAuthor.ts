/** Reads the git user name a project's commits carry, which an anonymous submission must not show. */
import { execFile } from "node:child_process";

/** Undefined when git is missing, the folder is not a repository or no name is set: all ordinary states. */
export function gitUserName(folder: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("git", ["config", "user.name"], { cwd: folder }, (error, stdout) => {
      const name = stdout.trim();
      resolve(error === null && name !== "" ? name : undefined);
    });
  });
}
