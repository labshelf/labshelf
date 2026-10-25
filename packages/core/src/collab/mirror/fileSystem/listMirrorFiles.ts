// Lists the files a mirror scans in a project folder, failing when the folder itself cannot be read.
import { listProjectFiles, type ProjectReadContext } from "../../../writing/project/index.js";
import { SHARED_TOOL_FILES } from "../../model/index.js";
import { MirrorProjectDirUnavailable } from "./mirrorFileSystem.js";

type FileReads = Pick<ProjectReadContext, "fs" | "paths">;

/** Throws MirrorProjectDirUnavailable unless the folder is a directory whose entries can be listed. */
export async function assertProjectDirReadable({ fs }: FileReads, folder: string): Promise<void> {
  try {
    if ((await fs.stat(folder))?.isDirectory !== true) { throw new Error(`${folder}: not a folder`); }
    await fs.listDir(folder);
  } catch (error) {
    throw new MirrorProjectDirUnavailable(folder, { cause: error });
  }
}

/** The project files, then each shared tool file that is present. */
export async function listMirrorFiles(reads: FileReads, folder: string): Promise<string[]> {
  await assertProjectDirReadable(reads, folder);
  const files = await listProjectFiles(reads, folder);
  for (const tool of SHARED_TOOL_FILES) {
    if ((await reads.fs.stat(reads.paths.join(folder, ...tool.split("/"))))?.isFile === true) { files.push(tool); }
  }
  return files;
}
