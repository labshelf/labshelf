// Keeps cloud writes outside the share until their relay history arrives.
import { recordFor } from "../../library/writeRecords/index.js";
import { readWrittenHashes } from "../model/index.js";
import { LOG_MODULE, type MirrorContext } from "./mirrorContext.js";

export interface WaitingWrite { hash: string; mirror: boolean; answered: boolean; canceled?: boolean }

export async function checkWaitingWrite(context: MirrorContext, path: string, hash: string): Promise<{ waiting: boolean; parent?: string | undefined }> {
  if (readWrittenHashes(context.session.index, path).has(hash)) { context.waitingWrites.delete(path); return { waiting: false }; }
  const records = await context.writeRecords.read();
  const record = recordFor(records, path, hash);
  const mirror = record?.by === "mirror";
  const parent = record?.parent ?? undefined;
  const previous = context.waitingWrites.get(path);
  if (previous?.hash === hash && previous.mirror === mirror && !previous.canceled) { return { waiting: mirror || !previous.answered, parent }; }
  const waiting: WaitingWrite = { hash, mirror, answered: false };
  context.waitingWrites.set(path, waiting);
  if (mirror) {
    await context.logger.log("INFO", LOG_MODULE, "Waiting for an in-flight mirror write", { folder: context.folder, path, hash });
  } else {
    const roundTrip = context.session.indexRoundTrip();
    if (!roundTrip) { context.waitingWrites.delete(path); return { waiting: false, parent }; }
    void roundTrip.then((answered) => {
      if (!answered) { waiting.canceled = true; return; }
      if (context.waitingWrites.get(path) !== waiting) { return; }
      waiting.answered = true;
      context.request(path, true);
    }).catch((error: unknown) => {
      waiting.canceled = true;
      return context.logger.error(LOG_MODULE, error, { folder: context.folder, path, action: "index round trip" });
    });
  }
  return { waiting: true, parent };
}
