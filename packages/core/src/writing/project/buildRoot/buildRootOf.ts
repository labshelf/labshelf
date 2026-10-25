/** Decides which project root a save of a source file builds: the file itself when it is a root, else the main file. */
import { listProjectFiles, type ProjectReadContext } from "../folder/index.js";
import { findBuildRoots } from "./buildRootDetection.js";

const SOURCE_EXTENSION = /\.(tex|typ)$/i;

type RootReads = Pick<ProjectReadContext, "fs" | "paths">;

async function readSource({ fs }: RootReads, absolute: string, relative: string): Promise<{ path: string; text: string } | undefined> {
  try {
    return { path: relative, text: await fs.readText(absolute) };
  } catch {
    return undefined; // an unreadable file cannot be a root
  }
}

/** Project-relative posix root a save of `file` (absolute) builds. */
export async function buildRootOf(reads: RootReads, projectFolder: string, main: string, file: string): Promise<string> {
  const { paths } = reads;
  const relative = paths.relative(projectFolder, file).split(paths.sep).join("/");
  if (relative.startsWith("..") || paths.isAbsolute(relative) || !SOURCE_EXTENSION.test(relative)) { return main; }
  const relatives = (await listProjectFiles(reads, projectFolder)).filter((candidate) => SOURCE_EXTENSION.test(candidate));
  const sources = await Promise.all(relatives.map((candidate) => readSource(reads, paths.join(projectFolder, candidate), candidate)));
  const roots = findBuildRoots(sources.filter((source) => source !== undefined));
  return roots.includes(relative) ? relative : main;
}
