// Writes the project's comments.json from the share's comments map; the map is the source and the file follows it.
// CONTRACT: documents/contracts/collaboration.md#comments
import { COMMENTS_PATH, renderCommentsFile } from "../comments/index.js";
import { indexComments } from "../model/index.js";
import type { DiskRead } from "./fileSystem/index.js";
import { LOG_MODULE, type MirrorContext } from "./mirrorContext.js";
import type { ReconcileOutcome } from "./pathQueue.js";

export async function reconcileComments(context: MirrorContext, disk: DiskRead): Promise<ReconcileOutcome> {
  if (disk.state === "changing") { return "changing"; }
  const existing = disk.state === "present" ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(disk.bytes) : undefined;
  const rendered = renderCommentsFile(context.session.index, existing);
  if (rendered === undefined) {
    await context.logger.log("WARN", LOG_MODULE, "Kept a comments.json that is not valid; fix or delete it to save the shared threads there", {
      folder: context.folder, path: COMMENTS_PATH,
    });
    return "done";
  }
  // An empty map writes no file into a project that has none.
  if (rendered === existing || (existing === undefined && indexComments(context.session.index).size === 0)) { return "done"; }
  await context.disk.write(COMMENTS_PATH, new TextEncoder().encode(rendered));
  await context.logger.log("INFO", LOG_MODULE, "Wrote the shared comment threads to comments.json", { folder: context.folder });
  return "done";
}
