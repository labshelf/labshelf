// Mirrors a project's files into the helper, sending only the files whose content the helper lacks.
import { chunkBytes, type HelperProject } from "@labshelf/core/helper";
import { describeFiles } from "./fileHashes";
import type { HelperConnection, RequestBody } from "../connection";

export async function syncProject(connection: HelperConnection, project: HelperProject): Promise<void> {
  const { projectId } = project;
  const files = await describeFiles(project.files);
  const need = await connection.request({ type: "sync", projectId, files }, (message) => (message.type === "need" ? { done: message.paths } : undefined));
  if (need.length === 0) { return; }
  const byPath = new Map(project.files.map((file) => [file.path, file]));
  const frames: RequestBody[] = need.flatMap((path) => {
    const file = byPath.get(path);
    if (!file) { throw new Error(`LabShelf Helper asked for ${path}, which is not in project ${projectId}`); }
    return chunkBytes(file.bytes).map((chunk): RequestBody => ({ type: "file", projectId, path, chunk }));
  });
  // The helper answers once the last chunk of every needed file has arrived, so only the final frame waits.
  for (const frame of frames.slice(0, -1)) { connection.post(frame); }
  await connection.request(frames[frames.length - 1] as RequestBody, (message) => {
    if (message.type !== "need") { return undefined; }
    if (message.paths.length > 0) { throw new Error(`LabShelf Helper still lacks ${message.paths.join(", ")} after the upload`); }
    return { done: undefined };
  });
}
