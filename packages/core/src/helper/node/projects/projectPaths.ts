// Resolves library and project paths with the bridge's confinement and maps its refusal to the helper's `path` code.
import { promises as fs } from "node:fs";
import { BridgeError } from "../../../bridge/bridgeError.js";
import { resolveInLibrary } from "../../../bridge/node/pathConfinement.js";
import { checkHelperPath } from "../../helperPaths.js";
import { HelperProjectError } from "./helperProjectError.js";

/** A confinement refusal becomes `path`; any other failure keeps its own error. */
export async function resolveConfinedPath(root: string, relative: string): Promise<string> {
  try {
    return await resolveInLibrary(root, relative);
  } catch (error) {
    if (error instanceof BridgeError && error.code === "outsideLibrary") {
      throw new HelperProjectError("path", error.message, { cause: error });
    }
    throw error;
  }
}

export function assertProjectPath(relative: string): string {
  const problem = checkHelperPath(relative);
  if (problem !== undefined) { throw new HelperProjectError("path", `Path "${relative}" is refused: ${problem}`); }
  return relative;
}

export async function readProjectText(projectRoot: string, relative: string): Promise<string> {
  const file = await resolveConfinedPath(projectRoot, assertProjectPath(relative));
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    throw new HelperProjectError("io", `Could not read "${relative}"`, { cause: error });
  }
}
