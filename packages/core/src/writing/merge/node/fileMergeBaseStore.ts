// Keeps merge bases as files in the library's device-local state directory, outside the synced library.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { deviceLocalLayout, writeFileAtomic } from "../../../library/node/index.js";
import { isProjectPath } from "../../history/index.js";
import type { IMergeBaseStore } from "../mergeBaseStore.js";

/**
 * @throws unless the value is a "/"-separated path inside its folder, and one segment for a project id:
 * ids and paths come from disk and sync. A backslash is refused so that `a\b` and `a/b` never share a base.
 */
function safeSegments(label: string, value: string, singleSegment: boolean): string[] {
  if (!isProjectPath(value) || /[\\\0]/.test(value) || (singleSegment && value.includes("/"))) {
    throw new Error(`Invalid merge base ${label}: ${JSON.stringify(value)}`);
  }
  return value.split("/");
}

export class FileMergeBaseStore implements IMergeBaseStore {
  private readonly baseDir: string;

  constructor(libraryRoot: string, env: NodeJS.ProcessEnv = process.env) {
    this.baseDir = deviceLocalLayout(libraryRoot, env).mergeBasesDir;
  }

  private fileFor(projectId: string, relativePath: string): string {
    return path.join(
      this.baseDir, ...safeSegments("project id", projectId, true), ...safeSegments("path", relativePath, false),
    );
  }

  async read(projectId: string, relativePath: string): Promise<string | undefined> {
    const file = this.fileFor(projectId, relativePath);
    try {
      return await fs.readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { return undefined; }
      throw new Error(`Cannot read merge base ${file}`, { cause: error });
    }
  }

  async write(projectId: string, relativePath: string, text: string): Promise<void> {
    const file = this.fileFor(projectId, relativePath);
    try {
      await writeFileAtomic(file, text);
    } catch (error) {
      throw new Error(`Cannot write merge base ${file}`, { cause: error });
    }
  }
}
